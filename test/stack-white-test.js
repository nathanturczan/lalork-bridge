#!/usr/bin/env node
/**
 * Deterministic tests for the Stack White MIDI instrument in
 * code/firestore-bridge.js. No network, no Max: max-api and https are mocked.
 *
 * Usage: node test/stack-white-test.js
 */

const assert = require('assert');
const Module = require('module');

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const handlers = {};
const outlets = [];   // every maxApi.outlet(...) call, as arrays
const posts = [];

const mockMaxApi = {
    addHandler(name, fn) { handlers[name] = fn; },
    outlet(...args) { outlets.push(args); },
    post(msg) { posts.push(String(msg)); }
};

// Current Firestore room doc served to every GET
let mockDoc = null;

const mockHttps = {
    Agent: function () {},
    get(url, opts, cb) {
        if (typeof opts === 'function') cb = opts;
        process.nextTick(() => {
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
        });
        return { on() { return this; } };
    },
    request() { throw new Error('httpPost not expected in these tests'); }
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'max-api') return mockMaxApi;
    if (request === 'https') return mockHttps;
    return origLoad.apply(this, arguments);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function midiEvents() {
    return outlets.filter(o => o[0] === 'midiNote').map(o => o.slice(1));
}
function clearMidi() { outlets.length = 0; }

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
    // Cmaj7: root 0, voicing pcs {0,4,7,11} -> palette [36,40,43,47]
    mockDoc = firestoreDoc({ bpm: 120, scaleData: 'c_diatonic', chordData: 'cmaj7-test', root: 0, voicing: [48, 52, 67, 71] });

    require('../code/firestore-bridge.js');

    handlers.interval(600000);       // effectively single-shot polling
    handlers.room('test-room');
    await sleep(50);

    console.log('single-device:');

    ok('no input -> no generated notes (drone removed)', () => {
        assert.deepStrictEqual(midiEvents(), []);
    });

    ok('Chord palette succession from C4 (48,52,55,59,60,64,67,71,72)', () => {
        clearMidi();
        const whiteKeys = [60, 62, 64, 65, 67, 69, 71, 72, 74]; // C4..D5, A..; on CMK
        whiteKeys.forEach((p, i) => handlers.noteIn(p, 100 - i, 1));
        assert.deepStrictEqual(midiEvents(), [
            [48, 100], [52, 99], [55, 98], [59, 97],
            [60, 96], [64, 95], [67, 94], [71, 93], [72, 92]
        ]);
        clearMidi();
        whiteKeys.forEach(p => handlers.noteIn(p, 0, 1));  // vel-0 note-on = note-off
        assert.deepStrictEqual(midiEvents(), [
            [48, 0], [52, 0], [55, 0], [59, 0],
            [60, 0], [64, 0], [67, 0], [71, 0], [72, 0]
        ]);
    });

    ok('black keys blocked, their note-offs dropped (Tonalign)', () => {
        clearMidi();
        [61, 63, 66, 68, 70].forEach(p => handlers.noteIn(p, 100, 1));
        [61, 63, 66, 68, 70].forEach(p => handlers.noteIn(p, 0, 1));
        assert.deepStrictEqual(midiEvents(), []);
    });

    ok('Root: A S D = root, F G H = fifth, J K L = root up an octave', () => {
        clearMidi();
        handlers.mode(1);
        // Cmaj7 root palette [36,36,36,43,43,43] (root near C2, perfect fifth)
        [60, 62, 64].forEach(p => handlers.noteIn(p, 90, 1));  // A S D -> root (refcounted)
        assert.deepStrictEqual(midiEvents(), [[36, 90]]);
        [65, 67, 69].forEach(p => handlers.noteIn(p, 90, 1));  // F G H -> fifth
        assert.deepStrictEqual(midiEvents(), [[36, 90], [43, 90]]);
        [71, 72, 74].forEach(p => handlers.noteIn(p, 90, 1));  // J K L -> root +12
        assert.deepStrictEqual(midiEvents(), [[36, 90], [43, 90], [48, 90]]);
        clearMidi();
        [60, 62, 64, 65, 67, 69, 71, 72, 74].forEach(p => handlers.noteIn(p, 0, 1));
        assert.deepStrictEqual(midiEvents(), [[36, 0], [43, 0], [48, 0]]);
    });

    // Root fifth fallback: chord without a perfect fifth uses the nearest chord tone
    {
        clearMidi();
        // Gm7b5: root 7, pcs {7,10,1,5} -> intervals {3,6,10}; nearest to 7 is 6
        mockDoc = firestoreDoc({ bpm: 120, scaleData: 'c_diatonic', chordData: 'gm7b5-test', root: 7, voicing: [43, 46, 49, 53] });
        handlers.poll();
        await sleep(50);
        handlers.noteIn(65, 90, 1);   // F key -> "fifth" = root(31) + 6 = 37
        assert.deepStrictEqual(midiEvents(), [[37, 90]]);
        handlers.noteIn(65, 0, 1);
        clearMidi();
        // equidistant tie {b5, #5}: pick the HIGHER (root+8), not the tritone
        mockDoc = firestoreDoc({ bpm: 120, scaleData: 'c_diatonic', chordData: 'tie-test', root: 0, voicing: [48, 54, 56] });
        handlers.poll();
        await sleep(50);
        handlers.noteIn(65, 90, 1);   // F key -> root(36) + 8 = 44
        assert.deepStrictEqual(midiEvents(), [[44, 90]]);
        handlers.noteIn(65, 0, 1);
        clearMidi();
        // equidistant tie {3rd, b7}: also the higher (root+10)
        mockDoc = firestoreDoc({ bpm: 120, scaleData: 'c_diatonic', chordData: 'no5-test', root: 0, voicing: [48, 52, 58] });
        handlers.poll();
        await sleep(50);
        handlers.noteIn(65, 90, 1);   // F key -> root(36) + 10 = 46
        assert.deepStrictEqual(midiEvents(), [[46, 90]]);
        handlers.noteIn(65, 0, 1);
        // restore Cmaj7 for the following tests
        mockDoc = firestoreDoc({ bpm: 120, scaleData: 'c_diatonic', chordData: 'cmaj7-test', root: 0, voicing: [48, 52, 67, 71] });
        handlers.poll();
        await sleep(50);
        passed++;
        console.log('  ok - Root fifth fallback: m7b5 -> b5; equidistant tie -> higher tone');
    }

    ok('Scale palette = fixed C window (C diatonic -> identity)', () => {
        clearMidi();
        handlers.mode(2);
        [60, 62, 64, 65, 67, 69, 71, 72].forEach(p => handlers.noteIn(p, 80, 1));
        assert.deepStrictEqual(midiEvents().map(e => e[0]), [60, 62, 64, 65, 67, 69, 71, 72]);
        clearMidi();
        [60, 62, 64, 65, 67, 69, 71, 72].forEach(p => handlers.noteIn(p, 0, 1));
        assert.strictEqual(midiEvents().length, 8);
        handlers.mode(0);
    });

    // scale change parsimony: shared pitch classes stay on the same keys
    {
        clearMidi();
        handlers.mode(2);
        handlers.noteIn(60, 80, 1);  // C key -> 60
        handlers.noteIn(65, 80, 1);  // F key -> 65
        // c_diatonic -> g_diatonic: only F -> F# changes
        mockDoc = firestoreDoc({ bpm: 120, scaleData: 'g_diatonic', chordData: 'cmaj7-test', root: 0, voicing: [48, 52, 67, 71] });
        handlers.poll();
        await sleep(50);
        const ev = midiEvents();
        // the C key survives without retrigger; only the F key re-pitches 65 -> 66
        assert.deepStrictEqual(ev, [[60, 80], [65, 80], [65, 0], [66, 80]],
            `parsimony events wrong: ${JSON.stringify(ev)}`);
        clearMidi();
        handlers.noteIn(60, 0, 1);
        handlers.noteIn(65, 0, 1);
        assert.deepStrictEqual(midiEvents(), [[60, 0], [66, 0]]);
        handlers.mode(0);
        passed++;
        console.log('  ok - scale change re-pitches only the changed scale tone (C window parsimony)');
    }

    ok('retriggered input without note-off does not stick', () => {
        clearMidi();
        handlers.noteIn(60, 100, 1);
        handlers.noteIn(60, 110, 1);
        assert.deepStrictEqual(midiEvents(), [[48, 100], [48, 0], [48, 110]]);
        clearMidi();
        handlers.noteIn(60, 0, 1);
        assert.deepStrictEqual(midiEvents(), [[48, 0]]);
    });

    ok('refcount: same output held on two channels releases once', () => {
        clearMidi();
        handlers.noteIn(60, 100, 1);
        handlers.noteIn(60, 100, 2);   // same output, no duplicate note-on
        assert.deepStrictEqual(midiEvents(), [[48, 100]]);
        handlers.noteIn(60, 0, 1);     // ch2 still holds it - no note-off yet
        assert.deepStrictEqual(midiEvents(), [[48, 100]]);
        handlers.noteIn(60, 0, 2);
        assert.deepStrictEqual(midiEvents(), [[48, 100], [48, 0]]);
    });

    console.log('held-note changes:');

    // harmony change re-pitches held notes (off before on, velocity kept)
    {
        clearMidi();
        handlers.noteIn(60, 100, 1);   // Cmaj7 chord palette -> 48
        handlers.noteIn(62, 90, 1);    //                     -> 52
        // Dm7: pcs {2,5,9,0} -> C window palette [48,50,53,57]
        mockDoc = firestoreDoc({ bpm: 120, scaleData: 'c_diatonic', chordData: 'dm7-test', root: 2, voicing: [50, 53, 57, 60] });
        handlers.poll();
        await sleep(50);
        const ev = midiEvents();
        assert.deepStrictEqual(ev.slice(0, 2), [[48, 100], [52, 90]]);
        // shared pc C stays on the same key (no retrigger); only E -> D moves
        assert.deepStrictEqual(ev.slice(2), [[52, 0], [50, 90]],
            `remap events wrong: ${JSON.stringify(ev)}`);
        clearMidi();
        // note-offs stop the NEW pitches
        handlers.noteIn(60, 0, 1);
        handlers.noteIn(62, 0, 1);
        assert.deepStrictEqual(midiEvents(), [[48, 0], [50, 0]]);
        passed++;
        console.log('  ok - harmony change re-pitches held notes (off before on, velocity kept)');
    }

    ok('NoteSource change re-pitches held notes', () => {
        clearMidi();
        handlers.noteIn(62, 100, 1);   // Dm7 chord palette -> 50
        handlers.mode(1);              // Root: palette [38x3,45x3] -> S key = root 38
        assert.deepStrictEqual(midiEvents(), [[50, 100], [50, 0], [38, 100]]);
        clearMidi();
        handlers.noteIn(62, 0, 1);
        assert.deepStrictEqual(midiEvents(), [[38, 0]]);
        handlers.mode(0);
    });

    // chord change that leaves the Root palette identical -> no events at all
    {
        clearMidi();
        handlers.mode(1);
        handlers.noteIn(60, 100, 1);   // Dm7 root -> 38
        // D7: same root (2), still has a perfect fifth -> identical Root palette
        mockDoc = firestoreDoc({ bpm: 120, scaleData: 'c_diatonic', chordData: 'd7-test', root: 2, voicing: [50, 54, 57, 60] });
        handlers.poll();
        await sleep(50);
        assert.deepStrictEqual(midiEvents(), [[38, 100]]);  // no off/on pair from the remap
        clearMidi();
        handlers.noteIn(60, 0, 1);
        assert.deepStrictEqual(midiEvents(), [[38, 0]]);
        handlers.mode(0);
        // restore Dm7 for the cleanup tests
        mockDoc = firestoreDoc({ bpm: 120, scaleData: 'c_diatonic', chordData: 'dm7-test', root: 2, voicing: [50, 53, 57, 60] });
        handlers.poll();
        await sleep(50);
        passed++;
        console.log('  ok - unchanged outputs survive remap without retrigger');
    }

    console.log('cleanup paths:');

    ok('CC123 flushes all generated notes and clears bookkeeping', () => {
        clearMidi();
        handlers.noteIn(60, 100, 1);
        handlers.noteIn(62, 90, 1);
        handlers.ccIn(0, 123);
        const ev = midiEvents();
        assert.deepStrictEqual(ev.slice(2).sort((a, b) => a[0] - b[0]), [[48, 0], [50, 0]]);
        clearMidi();
        handlers.noteIn(60, 0, 1);     // bookkeeping cleared - nothing to release
        assert.deepStrictEqual(midiEvents(), []);
    });

    ok('flush message releases everything', () => {
        clearMidi();
        handlers.noteIn(60, 100, 1);
        handlers.flush();
        assert.deepStrictEqual(midiEvents(), [[48, 100], [48, 0]]);
    });

    ok('disconnect releases held notes (no stuck notes)', () => {
        clearMidi();
        handlers.noteIn(60, 100, 1);
        handlers.disconnect();
        const ev = midiEvents();
        assert.deepStrictEqual(ev, [[48, 100], [48, 0]]);
    });

    ok('after disconnect, input generates nothing (no palette)', () => {
        clearMidi();
        handlers.noteIn(60, 100, 1);
        handlers.noteIn(60, 0, 1);
        assert.deepStrictEqual(midiEvents(), []);
    });

    console.log(`\n${passed} checks passed`);
    process.exit(0);
}

main().catch(err => {
    console.error('\nFAIL:', err.message);
    process.exit(1);
});
