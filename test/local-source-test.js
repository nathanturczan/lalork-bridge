#!/usr/bin/env node
/**
 * Deterministic tests for the Local Harmony Source (loopback HTTP endpoint)
 * in code/firestore-bridge.js — the offline MIDI 2.0 Flex Data path:
 *   PDF2PDF → Flex Data → adapter → POST /harmony → this bridge.
 *
 * max-api and https (Firestore) are mocked; the endpoint itself is REAL
 * (Node built-in http on 127.0.0.1, so no external network is touched).
 *
 * Usage: node test/local-source-test.js
 */

const assert = require('assert');
const Module = require('module');
const http = require('http');
const net = require('net');

const PORT = 18767;   // moved off the 8767 default so a live device can't collide

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const handlers = {};
const outlets = [];
const posts = [];

const mockMaxApi = {
    addHandler(name, fn) { handlers[name] = fn; },
    outlet(...args) { outlets.push(args); },
    post(msg) { posts.push(String(msg)); }
};

// Controllable Firestore mock: holdGets=true parks responses until flushGets()
let mockDoc = null;
let holdGets = false;
let pendingGets = [];

const mockHttps = {
    Agent: function () {},
    get(url, opts, cb) {
        if (typeof opts === 'function') cb = opts;
        const deliver = () => {
            const listeners = {};
            const res = {
                statusCode: 200,
                on(ev, fn) { listeners[ev] = fn; return res; }
            };
            cb(res);
            process.nextTick(() => {
                listeners['data'](JSON.stringify(mockDoc));
                listeners['end']();
            });
        };
        if (holdGets) pendingGets.push(deliver);
        else process.nextTick(deliver);
        return { on() { return this; } };
    },
    request() { throw new Error('httpPost not expected in these tests'); }
};

function flushGets() {
    const p = pendingGets;
    pendingGets = [];
    for (const fn of p) process.nextTick(fn);
}

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'max-api') return mockMaxApi;
    if (request === 'https') return mockHttps;
    return origLoad.apply(this, arguments);   // 'http' stays REAL
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function request({ method = 'POST', path = '/harmony', headers = {}, body, port = PORT }) {
    return new Promise((resolve, reject) => {
        // agent:false — one connection per request, so a request the server
        // destroys (413) can never poison a kept-alive socket for the next one
        const req = http.request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        if (body !== undefined) req.write(body);
        req.end();
    });
}

function postJson(obj) {
    return request({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
}

function outletsOf(name) { return outlets.filter(o => o[0] === name).map(o => o.slice(1)); }
function midiEvents() { return outletsOf('midiNote'); }
function clearOut() { outlets.length = 0; posts.length = 0; }

function firestoreDoc({ bpm, scaleData, chordData, root, voicing }) {
    const fields = {
        bpm: { integerValue: String(bpm) },
        scaleData: { stringValue: scaleData },
        chordData: { stringValue: chordData }
    };
    if (voicing) {
        fields.chordInfo = { mapValue: { fields: {
            id: { stringValue: chordData },
            root: { integerValue: String(root) },
            voicing: { arrayValue: { values: voicing.map(n => ({ integerValue: String(n) })) } }
        } } };
    }
    return { fields };
}

let passed = 0;
function ok(name, fn) {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
    require('../code/firestore-bridge.js');
    handlers.interval(600000);   // effectively single-shot Firestore polling

    // Move the endpoint off the default port (a live device may own 8767)
    handlers.localPort(PORT);
    await sleep(80);
    assert(posts.some(p => p.includes(`listening on http://127.0.0.1:${PORT}/harmony`)),
        `no listening post; posts: ${JSON.stringify(posts)}`);
    console.log('endpoint validation:');
    clearOut();

    {
        const r = await request({ method: 'GET' });
        ok('non-POST method rejected (405)', () => assert.strictEqual(r.status, 405));
    }
    {
        const r = await request({ path: '/nope', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        ok('unknown path rejected (404)', () => assert.strictEqual(r.status, 404));
    }
    {
        const r = await request({ headers: { 'Content-Type': 'text/plain' }, body: '{"bpm":100}' });
        ok('wrong Content-Type rejected (415) — blocks CORS simple-request drive-bys', () =>
            assert.strictEqual(r.status, 415));
    }
    {
        const r = await request({ headers: { 'Content-Type': 'application/json' }, body: 'not json' });
        ok('invalid JSON rejected (400)', () => assert.strictEqual(r.status, 400));
    }
    {
        const r = await postJson([1, 2, 3]);
        ok('non-object body rejected (400)', () => {
            assert.strictEqual(r.status, 400);
            assert(JSON.parse(r.body).error.includes('JSON object'));
        });
    }
    {
        // Vocabulary mistake: adapter-internal names instead of room names
        const r = await postJson({ scaleKey: 'c_diatonic', chordKey: 'c_7-17' });
        ok('unknown fields rejected with the accepted vocabulary named', () => {
            assert.strictEqual(r.status, 400);
            const err = JSON.parse(r.body).error;
            assert(err.includes('scaleKey') && err.includes('scaleData'), err);
        });
    }
    {
        const r1 = await postJson({ bpm: 10 });
        const r2 = await postJson({ bpm: null });
        const r3 = await postJson({ bpm: 'fast' });
        ok('bpm out of range / null / non-number rejected (400)', () => {
            assert.strictEqual(r1.status, 400);
            assert.strictEqual(r2.status, 400);
            assert.strictEqual(r3.status, 400);
        });
    }
    {
        const r1 = await postJson({ scaleData: 'q_diatonic' });
        const r2 = await postJson({ scaleData: 'c_klingon' });
        const r3 = await postJson({ scaleData: 7 });
        ok('invalid scaleData tokens rejected (400)', () => {
            assert.strictEqual(r1.status, 400);
            assert.strictEqual(r2.status, 400);
            assert.strictEqual(r3.status, 400);
        });
    }
    {
        const r1 = await postJson({ chordData: 123 });
        const r2 = await postJson({ chordData: '' });
        ok('invalid chordData rejected (400)', () => {
            assert.strictEqual(r1.status, 400);
            assert.strictEqual(r2.status, 400);
        });
    }
    {
        const r = await postJson({ externalBassPc: 12 });
        ok('externalBassPc out of range rejected (400)', () => assert.strictEqual(r.status, 400));
    }
    {
        const r = await request({
            headers: { 'Content-Type': 'application/json' },
            body: '{"chordData":"' + 'x'.repeat(5000) + '"}'
        }).catch(e => ({ status: 413, aborted: true }));   // server may destroy the socket mid-send
        ok('oversized body rejected (413/aborted)', () => assert.strictEqual(r.status, 413));
    }
    ok('rejected requests changed nothing (no harmony outlets)', () => {
        assert.strictEqual(outletsOf('bpm').length, 0);
        assert.strictEqual(outletsOf('chord').length, 0);
        assert.strictEqual(outletsOf('rootName').length, 0);
        assert.strictEqual(midiEvents().length, 0);
    });

    console.log('CORS (browser adapter page):');
    {
        const r = await request({ method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
        ok('preflight from a local origin allowed (204, origin reflected)', () => {
            assert.strictEqual(r.status, 204);
            assert.strictEqual(r.headers['access-control-allow-origin'], 'http://localhost:5173');
            assert(r.headers['access-control-allow-methods'].includes('POST'));
        });
    }
    {
        const r = await request({ method: 'OPTIONS', headers: { Origin: 'http://evil.example' } });
        ok('preflight from a non-local origin gets no CORS grant', () => {
            assert.strictEqual(r.headers['access-control-allow-origin'], undefined);
        });
    }

    console.log('local application:');
    clearOut();
    {
        const r = await postJson({ bpm: 96 });
        ok('partial update: bpm only', () => {
            assert.strictEqual(r.status, 200);
            assert.deepStrictEqual(JSON.parse(r.body), { ok: true, source: 'local' });
            assert.deepStrictEqual(outletsOf('bpm'), [[96]]);
            assert.strictEqual(outletsOf('chord').length, 0);
            assert.strictEqual(outletsOf('rootName').length, 0);
        });
    }
    ok('local source announces itself (status + log)', () => {
        assert(outletsOf('status').some(s => s[0] === 'local'), JSON.stringify(outletsOf('status')));
        assert(posts.some(p => p.includes('Local harmony source active')));
    });
    clearOut();
    {
        await postJson({ scaleData: 'c_diatonic', chordData: 'c_7-17' });
        ok('scale + chord apply through the shared path (chord DB voicing)', () => {
            assert.deepStrictEqual(outletsOf('rootNote'), [[0]]);
            assert.deepStrictEqual(outletsOf('rootName'), [['C']]);
            assert.deepStrictEqual(outletsOf('scaleClass'), [['Diatonic']]);
            assert.deepStrictEqual(outletsOf('scaleName'), [['Major']]);
            assert.deepStrictEqual(outletsOf('chord'), [['c_7-17']]);
        });
    }
    ok('performer notes play the local chord palette (C7 → [48,52,55,58])', () => {
        clearOut();
        [60, 62, 64, 65].forEach((p, i) => handlers.noteIn(p, 100 - i, 1));
        assert.deepStrictEqual(midiEvents(), [[48, 100], [52, 99], [55, 98], [58, 97]]);
        clearOut();
        [62, 64, 65].forEach(p => handlers.noteIn(p, 0, 1));   // keep C4 held for the next test
        assert.deepStrictEqual(midiEvents(), [[52, 0], [55, 0], [58, 0]]);
    });
    {
        clearOut();
        handlers.noteIn(62, 90, 1);   // D key on C7 → 52
        await postJson({ chordData: 'd_m7-13' });   // palette [48,50,53,57]
        ok('local chord change re-pitches held notes (off before on)', () => {
            const ev = midiEvents();
            // held C4 (48) survives (shared pc), D key 52 → 50
            assert.deepStrictEqual(ev, [[52, 90], [52, 0], [50, 90]], JSON.stringify(ev));
        });
    }
    {
        clearOut();
        const r = await postJson({ chordData: 'd_m7-13', scaleData: 'c_diatonic' });
        ok('duplicate local update suppressed (200, zero outlets)', () => {
            assert.strictEqual(r.status, 200);
            assert.strictEqual(outlets.length, 0);
        });
    }
    {
        clearOut();
        await postJson({ chordData: null });
        ok('explicit chord clear: display cleared, held notes released', () => {
            assert.deepStrictEqual(outletsOf('chord'), [['']]);
            // both held keys lose their palette → note-offs for 48 and 50
            assert.deepStrictEqual(midiEvents().sort((a, b) => a[0] - b[0]), [[48, 0], [50, 0]]);
        });
        clearOut();
        handlers.noteIn(60, 100, 1);
        ok('after chord clear, Chord-mode input is blocked (no palette)', () => {
            assert.deepStrictEqual(midiEvents(), []);
        });
        await postJson({ scaleData: null });
        ok('explicit scale clear: displays cleared', () => {
            assert.deepStrictEqual(outletsOf('rootName'), [['']]);
            assert.deepStrictEqual(outletsOf('scaleClass'), [['']]);
        });
        handlers.noteIn(60, 0, 1);
        handlers.noteIn(62, 0, 1);
    }
    console.log('exact voicings (chordInfo) + slash bass:');
    clearOut();
    {
        const r1 = await postJson({ chordInfo: { id: 'G', root: 7, voicing: [55, 59, 62] } });
        const r2 = await postJson({ chordData: 'G', chordInfo: { id: 'Am', root: 9, voicing: [57, 60, 64] } });
        const r3 = await postJson({ chordData: 'G', chordInfo: { id: 'G', root: 7, voicing: [] } });
        const r4 = await postJson({ chordData: 'G', chordInfo: { id: 'G', root: 7, voicing: [55, 'x'] } });
        const r5 = await postJson({ chordData: 'G', chordInfo: { id: 'G', root: 99, voicing: [55, 59, 62] } });
        const r6 = await postJson({ chordData: 'G', chordInfo: { id: 'G', notes: [55] } });
        ok('malformed chordInfo rejected (no chordData / id mismatch / bad voicing / bad root / unknown field)', () => {
            for (const r of [r1, r2, r3, r4, r5, r6]) assert.strictEqual(r.status, 400);
        });
    }
    {
        const r = await postJson({ externalBassPc: 4 });
        ok('externalBassPc without chordData rejected (bass is chord-scoped)', () =>
            assert.strictEqual(r.status, 400));
    }
    ok('rejected chordInfo posts changed nothing', () => {
        assert.strictEqual(outletsOf('chord').length, 0);
        assert.strictEqual(midiEvents().length, 0);
    });
    {
        clearOut();
        await postJson({ chordData: 'G', chordInfo: { id: 'G', root: 7, voicing: [55, 59, 62] } });
        ok('exact chordInfo voicing plays verbatim (plain G triad, no Boyd added 6th)', () => {
            assert.deepStrictEqual(outletsOf('chord'), [['G']]);
            clearOut();
            [60, 62, 64].forEach(p => handlers.noteIn(p, 100, 1));
            // pcs {7,11,2} in the C3 window → [50, 55, 59]
            assert.deepStrictEqual(midiEvents(), [[50, 100], [55, 100], [59, 100]]);
            [60, 62, 64].forEach(p => handlers.noteIn(p, 0, 1));
        });
    }
    {
        clearOut();
        const r = await postJson({ chordData: 'G', chordInfo: { id: 'G', root: 7, voicing: [55, 59, 62] } });
        ok('identical (id, voicing) deduped (200, zero outlets)', () => {
            assert.strictEqual(r.status, 200);
            assert.strictEqual(outlets.length, 0);
        });
    }
    {
        clearOut();
        await postJson({ chordData: 'G', chordInfo: { id: 'G', root: 7, voicing: [55, 58, 62] } });
        ok('same id with a NEW voicing re-applies (voicing-aware dedup)', () => {
            assert.deepStrictEqual(outletsOf('chord'), [['G']]);
            clearOut();
            handlers.noteIn(64, 100, 1);   // E key, degree 2 → pcs {7,10,2} → 58
            assert.deepStrictEqual(midiEvents(), [[58, 100]]);
            handlers.noteIn(64, 0, 1);
        });
    }
    {
        clearOut();
        handlers.mode(1);   // Root NoteSource
        await postJson({ chordData: 'Am/G', chordInfo: { id: 'Am/G', root: 9, voicing: [57, 60, 64] }, externalBassPc: 7 });
        ok('slash bass overrides the Root palette (Am/G → G in the bass)', () => {
            assert.deepStrictEqual(outletsOf('chord'), [['Am/G']]);
            clearOut();
            handlers.noteIn(60, 100, 1);
            assert.deepStrictEqual(midiEvents(), [[31, 100]]);   // G1 = placeNear48(7) - 12
        });
    }
    {
        clearOut();
        const r = await postJson({ chordData: 'Am/G', chordInfo: { id: 'Am/G', root: 9, voicing: [57, 60, 64] }, externalBassPc: 7 });
        ok('identical (id, voicing, bass) deduped', () => {
            assert.strictEqual(r.status, 200);
            assert.strictEqual(outlets.length, 0);
        });
    }
    {
        clearOut();
        await postJson({ chordData: 'Am', chordInfo: { id: 'Am', root: 9, voicing: [57, 60, 64] } });
        ok('next chord without a bass resets the override (chord-scoped)', () => {
            const ev = midiEvents();
            // held root key re-pitches from G1 (31) to A1 (33)
            assert.deepStrictEqual(ev, [[31, 0], [33, 100]], JSON.stringify(ev));
            handlers.noteIn(60, 0, 1);
            handlers.mode(0);   // back to Chord NoteSource
        });
    }

    console.log('source precedence:');
    {
        // Explicit room join switches to Firestore
        mockDoc = firestoreDoc({ bpm: 120, scaleData: 'g_diatonic', chordData: 'g_7-17', root: 7, voicing: [55, 65, 71, 74] });
        clearOut();
        handlers.room('test-room');
        await sleep(50);
        ok('explicit room join switches back to Firestore', () => {
            assert(outletsOf('status').some(s => s[0] === 'connected'));
            assert.deepStrictEqual(outletsOf('chord').slice(-1), [['g_7-17']]);
            assert.deepStrictEqual(outletsOf('rootName').slice(-1), [['G']]);
        });
    }
    {
        clearOut();
        await postJson({ chordData: 'c_7-17', scaleData: 'c_diatonic' });
        ok('valid local update takes over from Firestore (polling paused)', () => {
            assert(posts.some(p => p.includes('Firestore polling paused')));
            assert(outletsOf('status').some(s => s[0] === 'local'));
            assert.deepStrictEqual(outletsOf('chord'), [['c_7-17']]);
        });
        clearOut();
        handlers.poll();   // manual poll while paused: enabled=false → no-op
        await sleep(50);
        ok('paused Firestore polling stays silent', () => {
            assert.strictEqual(outletsOf('chord').length, 0);
            assert.strictEqual(outletsOf('bpm').length, 0);
        });
    }
    {
        // Stale in-flight Firestore result must not overwrite a local update
        handlers.room('test-room');   // back on Firestore (g_diatonic / g_7-17)
        await sleep(50);
        mockDoc = firestoreDoc({ bpm: 140, scaleData: 'd_diatonic', chordData: 'd_m7-13', root: 2, voicing: [50, 60, 65, 69] });
        holdGets = true;
        handlers.poll();              // in flight, parked
        await sleep(20);
        clearOut();
        await postJson({ chordData: 'c_7-17', scaleData: 'c_diatonic' });   // local takes over
        flushGets();                  // stale poll result arrives AFTER takeover
        await sleep(50);
        holdGets = false;
        ok('stale in-flight Firestore poll is discarded after local takeover', () => {
            assert(posts.some(p => p.includes('Poll result discarded')), JSON.stringify(posts));
            assert.strictEqual(outletsOf('bpm').length, 0, 'stale bpm 140 must not apply');
            assert(!outletsOf('rootName').some(r => r[0] === 'D'), 'stale scale must not apply');
            assert.deepStrictEqual(outletsOf('chord'), [['c_7-17']]);
        });
    }

    console.log('sender restart / lifecycle:');
    {
        clearOut();
        handlers.disconnect();        // full reset to idle
        clearOut();
        const r = await postJson({ bpm: 101, scaleData: 'c_diatonic', chordData: 'c_7-17' });
        ok('a restarted sender re-activates the local source from idle', () => {
            assert.strictEqual(r.status, 200);
            assert.deepStrictEqual(outletsOf('bpm'), [[101]]);
            assert.deepStrictEqual(outletsOf('chord'), [['c_7-17']]);
        });
    }
    {
        handlers.localPort(0);        // disable
        await sleep(50);
        let refused = false;
        try { await postJson({ bpm: 102 }); } catch (e) { refused = true; }
        ok('localPort 0 disables the endpoint (connection refused)', () => assert(refused));
        handlers.localPort(PORT);     // re-enable on the same port
        await sleep(50);
        const r = await postJson({ bpm: 103 });
        ok('endpoint restart on the same port recovers', () => assert.strictEqual(r.status, 200));
    }
    {
        // EADDRINUSE: another listener owns the port → clear log, no crash
        const blocker = net.createServer();
        await new Promise(res => blocker.listen(PORT + 1, '127.0.0.1', res));
        posts.length = 0;
        handlers.localPort(PORT + 1);
        await sleep(80);
        ok('occupied port reported clearly (single-listener limitation)', () => {
            assert(posts.some(p => p.includes(`port ${PORT + 1} already in use`)), JSON.stringify(posts));
        });
        blocker.close();
        handlers.localPort(PORT);
        await sleep(50);
        const r = await postJson({ bpm: 104 });
        assert.strictEqual(r.status, 200);
    }

    console.log(`\n${passed} checks passed`);
    process.exit(0);
}

main().catch(err => {
    console.error('\nFAIL:', err.message);
    process.exit(1);
});
