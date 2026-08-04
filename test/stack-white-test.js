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
    get(url, cb) {
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
    // Cmaj7: root 0, voicing pcs {0,4,7,11} -> palette [60,64,67,71]
    mockDoc = firestoreDoc({ bpm: 120, scaleData: 'c_diatonic', chordData: 'cmaj7-test', root: 0, voicing: [48, 52, 67, 71] });

    require('../code/firestore-bridge.js');

    handlers.interval(600000);       // effectively single-shot polling
    handlers.room('test-room');
    await sleep(50);

    console.log('single-device:');

    ok('no input -> no generated notes (drone removed)', () => {
        assert.deepStrictEqual(midiEvents(), []);
    });

    ok('Chord palette succession from C4 (spec: 60,64,67,71,72,76,79,83,84)', () => {
        clearMidi();
        const whiteKeys = [60, 62, 64, 65, 67, 69, 71, 72, 74]; // C4..D5, A..; on CMK
        whiteKeys.forEach((p, i) => handlers.noteIn(p, 100 - i, 1));
        assert.deepStrictEqual(midiEvents(), [
            [60, 100], [64, 99], [67, 98], [71, 97],
            [72, 96], [76, 95], [79, 94], [83, 93], [84, 92]
        ]);
        clearMidi();
        whiteKeys.forEach(p => handlers.noteIn(p, 0, 1));  // vel-0 note-on = note-off
        assert.deepStrictEqual(midiEvents(), [
            [60, 0], [64, 0], [67, 0], [71, 0],
            [72, 0], [76, 0], [79, 0], [83, 0], [84, 0]
        ]);
    });

    ok('black keys blocked, their note-offs dropped (Tonalign)', () => {
        clearMidi();
        [61, 63, 66, 68, 70].forEach(p => handlers.noteIn(p, 100, 1));
        [61, 63, 66, 68, 70].forEach(p => handlers.noteIn(p, 0, 1));
        assert.deepStrictEqual(midiEvents(), []);
    });

    ok('Root palette = successive octaves of chord root', () => {
        clearMidi();
        handlers.mode(1);
        [60, 62, 64].forEach(p => handlers.noteIn(p, 90, 1));
        assert.deepStrictEqual(midiEvents(), [[60, 90], [72, 90], [84, 90]]);
        clearMidi();
        [60, 62, 64].forEach(p => handlers.noteIn(p, 0, 1));
        assert.deepStrictEqual(midiEvents(), [[60, 0], [72, 0], [84, 0]]);
    });

    ok('Scale palette = scale degrees from scale root (C diatonic = identity on white keys)', () => {
        clearMidi();
        handlers.mode(2);
        [60, 62, 64, 65, 67, 69, 71, 72].forEach(p => handlers.noteIn(p, 80, 1));
        assert.deepStrictEqual(midiEvents().map(e => e[0]), [60, 62, 64, 65, 67, 69, 71, 72]);
        clearMidi();
        [60, 62, 64, 65, 67, 69, 71, 72].forEach(p => handlers.noteIn(p, 0, 1));
        assert.strictEqual(midiEvents().length, 8);
        handlers.mode(0);
    });

    ok('retriggered input without note-off does not stick', () => {
        clearMidi();
        handlers.noteIn(60, 100, 1);
        handlers.noteIn(60, 110, 1);
        assert.deepStrictEqual(midiEvents(), [[60, 100], [60, 0], [60, 110]]);
        clearMidi();
        handlers.noteIn(60, 0, 1);
        assert.deepStrictEqual(midiEvents(), [[60, 0]]);
    });

    ok('refcount: same output held on two channels releases once', () => {
        clearMidi();
        handlers.noteIn(60, 100, 1);
        handlers.noteIn(60, 100, 2);   // same output, no duplicate note-on
        assert.deepStrictEqual(midiEvents(), [[60, 100]]);
        handlers.noteIn(60, 0, 1);     // ch2 still holds it - no note-off yet
        assert.deepStrictEqual(midiEvents(), [[60, 100]]);
        handlers.noteIn(60, 0, 2);
        assert.deepStrictEqual(midiEvents(), [[60, 100], [60, 0]]);
    });

    console.log('held-note changes:');

    // harmony change re-pitches held notes (off before on, velocity kept)
    {
        clearMidi();
        handlers.noteIn(60, 100, 1);   // Cmaj7 chord palette -> 60
        handlers.noteIn(62, 90, 1);    //                     -> 64
        // Dm7: root 2, pcs {2,5,9,0} -> palette [62,65,69,72]
        mockDoc = firestoreDoc({ bpm: 120, scaleData: 'c_diatonic', chordData: 'dm7-test', root: 2, voicing: [50, 53, 57, 60] });
        handlers.poll();
        await sleep(50);
        const ev = midiEvents();
        assert.deepStrictEqual(ev.slice(0, 2), [[60, 100], [64, 90]]);
        assert.deepStrictEqual(ev.slice(2), [[60, 0], [64, 0], [62, 100], [65, 90]],
            `remap events wrong: ${JSON.stringify(ev)}`);
        clearMidi();
        // note-offs stop the NEW pitches
        handlers.noteIn(60, 0, 1);
        handlers.noteIn(62, 0, 1);
        assert.deepStrictEqual(midiEvents(), [[62, 0], [65, 0]]);
        passed++;
        console.log('  ok - harmony change re-pitches held notes (off before on, velocity kept)');
    }

    ok('NoteSource change re-pitches held notes', () => {
        clearMidi();
        handlers.noteIn(62, 100, 1);   // Dm7 chord palette -> 65
        handlers.mode(1);              // Root: palette [62] -> input 62 = second octave 74
        assert.deepStrictEqual(midiEvents(), [[65, 100], [65, 0], [74, 100]]);
        clearMidi();
        handlers.noteIn(62, 0, 1);
        assert.deepStrictEqual(midiEvents(), [[74, 0]]);
        handlers.mode(0);
    });

    ok('unchanged outputs survive remap without retrigger', () => {
        clearMidi();
        handlers.noteIn(60, 100, 1);   // Dm7 chord -> 62
        handlers.mode(1);              // Root palette [62]: input 60 -> 62 (unchanged)
        assert.deepStrictEqual(midiEvents(), [[62, 100]]);  // no off/on pair from the remap
        clearMidi();
        handlers.noteIn(60, 0, 1);
        assert.deepStrictEqual(midiEvents(), [[62, 0]]);
        handlers.mode(0);
    });

    console.log('cleanup paths:');

    ok('CC123 flushes all generated notes and clears bookkeeping', () => {
        clearMidi();
        handlers.noteIn(60, 100, 1);
        handlers.noteIn(62, 90, 1);
        handlers.ccIn(0, 123);
        const ev = midiEvents();
        assert.deepStrictEqual(ev.slice(2).sort((a, b) => a[0] - b[0]), [[62, 0], [65, 0]]);
        clearMidi();
        handlers.noteIn(60, 0, 1);     // bookkeeping cleared - nothing to release
        assert.deepStrictEqual(midiEvents(), []);
    });

    ok('flush message releases everything', () => {
        clearMidi();
        handlers.noteIn(60, 100, 1);
        handlers.flush();
        assert.deepStrictEqual(midiEvents(), [[62, 100], [62, 0]]);
    });

    ok('disconnect releases held notes (no stuck notes)', () => {
        clearMidi();
        handlers.noteIn(60, 100, 1);
        handlers.disconnect();
        const ev = midiEvents();
        assert.deepStrictEqual(ev, [[62, 100], [62, 0]]);
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
