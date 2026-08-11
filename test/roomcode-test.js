#!/usr/bin/env node
/**
 * Deterministic tests for the roomcode display protocol (#27).
 *
 * The patch `set`s the JS's `roomcode` outlet into the room textedit, so the
 * emission rules matter:
 *   - emitted once per successful (re)connection, not per poll
 *   - re-emitted after error -> recovery (banner + field rebuild)
 *   - NOT blanked during a room switch or failed join (would wipe typed input)
 *   - blanked only on genuine clear (room '', disconnect)
 *   - lobby picks display the friendly roomName, never the doc ID
 *
 * Usage: node test/roomcode-test.js
 */

const assert = require('assert');
const Module = require('module');

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const handlers = {};
const outlets = [];

const mockMaxApi = {
    addHandler(name, fn) { handlers[name] = fn; },
    outlet(...args) { outlets.push(args); },
    post() {}
};

// docId -> Firestore doc; unknown ids 404
const mockRooms = {};
let failAll = false;   // simulate network/server failure (HTTP 500)

function respond(cb, status, body) {
    process.nextTick(() => {
        const listeners = {};
        const res = { statusCode: status, on(ev, fn) { listeners[ev] = fn; return res; } };
        cb(res);
        process.nextTick(() => { listeners['data'](body); listeners['end'](); });
    });
}

const mockHttps = {
    get(url, cb) {
        if (failAll) { respond(cb, 500, '{}'); return { on() { return this; } }; }
        if (url.includes('pageSize')) {
            // room list
            const documents = Object.keys(mockRooms).map(id => ({
                name: `projects/x/databases/(default)/documents/rooms/${id}`,
                fields: mockRooms[id].fields.roomName
                    ? { roomName: mockRooms[id].fields.roomName } : {},
                updateTime: '2026-01-01T00:00:00Z'
            }));
            respond(cb, 200, JSON.stringify({ documents }));
        } else {
            const id = url.split('/').pop();
            if (mockRooms[id]) respond(cb, 200, JSON.stringify(mockRooms[id]));
            else respond(cb, 404, '{}');
        }
        return { on() { return this; } };
    },
    request(options, cb) {
        // slug runQuery: always no results
        respond(cb, 200, '[]');
        return { on() { return this; }, write() {}, end() {} };
    }
};

const origLoad = Module._load;
Module._load = function (request) {
    if (request === 'max-api') return mockMaxApi;
    if (request === 'https') return mockHttps;
    return origLoad.apply(this, arguments);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function roomcodes() { return outlets.filter(o => o[0] === 'roomcode').map(o => o[1]); }
function statuses() { return outlets.filter(o => o[0] === 'status').map(o => o[1]); }
function clearOut() { outlets.length = 0; }

function doc(roomName) {
    const fields = {
        bpm: { integerValue: '120' },
        scaleData: { stringValue: 'c_diatonic' },
        chordData: { stringValue: 'cmaj7-x' }
    };
    if (roomName) fields.roomName = { stringValue: roomName };
    return { fields };
}

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log(`  ok - ${name}`); }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
    mockRooms['test-room'] = doc();
    mockRooms['other-room'] = doc();
    mockRooms['rehearse-abc123'] = doc('Private Rehearsal');

    require('../code/firestore-bridge.js');
    handlers.interval(600000);  // effectively single-shot; polls driven manually

    handlers.room('test-room');
    await sleep(50);

    ok('join emits roomcode exactly once (idle at load -> connecting -> connected)', () => {
        assert.deepStrictEqual(roomcodes(), ['test-room']);
        assert.deepStrictEqual(statuses(), ['idle', 'ready', 'connected']);
    });

    clearOut();
    handlers.poll(); await sleep(50);
    handlers.poll(); await sleep(50);
    ok('subsequent polls do not re-emit roomcode (no textedit stomping)', () => {
        assert.deepStrictEqual(roomcodes(), []);
        assert.deepStrictEqual(statuses(), []);
    });

    clearOut();
    failAll = true;
    handlers.poll(); await sleep(50);
    ok('poll failure -> error status, roomcode untouched', () => {
        assert.deepStrictEqual(statuses(), ['error']);
        assert.deepStrictEqual(roomcodes(), []);
    });

    failAll = false;
    handlers.poll(); await sleep(50);
    ok('recovery re-emits roomcode once (banner + field rebuild)', () => {
        assert.deepStrictEqual(statuses(), ['error', 'connected']);
        assert.deepStrictEqual(roomcodes(), ['test-room']);
    });

    clearOut();
    handlers.room('other-room'); await sleep(50);
    ok('room switch: no blank in between, new code emitted once', () => {
        assert.deepStrictEqual(roomcodes(), ['other-room']);  // no '' first
        assert.deepStrictEqual(statuses(), ['ready', 'connected']);
    });

    clearOut();
    handlers.room('no-such-room'); await sleep(80);
    ok('failed join (typo): roomcode NOT emitted, typed input survives', () => {
        assert.deepStrictEqual(roomcodes(), []);  // especially: no ''
        assert.deepStrictEqual(statuses(), ['ready', 'error']);
    });

    clearOut();
    handlers.room('rehearse-abc123'); await sleep(50);
    ok('recover from typo by joining a real room', () => {
        assert.deepStrictEqual(roomcodes(), ['rehearse-abc123']);
        assert.deepStrictEqual(statuses(), ['ready', 'connected']);
    });

    clearOut();
    handlers.room(); await sleep(50);
    ok('room clear: empty roomcode + idle', () => {
        assert.deepStrictEqual(roomcodes(), ['']);
        assert.deepStrictEqual(statuses(), ['idle']);
    });

    // Lobby path: friendly name, never the doc ID
    mockRooms['abc123xyz'] = doc('Dylans Band');
    clearOut();
    handlers.refreshRooms(); await sleep(50);
    const appended = outlets.filter(o => o[0] === 'rooms' && o[1] === 'append').map(o => o[2]);
    const idx = appended.indexOf('Dylans Band');
    assert.ok(idx >= 0, 'lobby list contains Dylans Band');
    clearOut();
    handlers.selectRoom(idx); await sleep(50);
    ok('lobby pick displays friendly roomName, never the doc ID', () => {
        const rc = roomcodes();
        assert.ok(rc.length >= 1 && rc.every(c => c === 'Dylans Band'), JSON.stringify(rc));
        assert.strictEqual(statuses().pop(), 'connected');
    });

    clearOut();
    handlers.poll(); await sleep(50);
    ok('post-connect polls after lobby pick stay silent', () => {
        assert.deepStrictEqual(roomcodes(), []);
    });

    clearOut();
    handlers.disconnect(); await sleep(20);
    ok('disconnect: empty roomcode + disconnected', () => {
        assert.deepStrictEqual(roomcodes(), ['']);
        assert.deepStrictEqual(statuses(), ['disconnected']);
    });

    console.log(`\n${passed} checks passed`);
}

main().catch(err => { console.error(err); process.exit(1); });
