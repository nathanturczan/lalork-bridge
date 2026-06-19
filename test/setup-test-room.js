#!/usr/bin/env node
/**
 * Setup Test Room for Scale Navigator Bridge
 *
 * Creates or updates a test room in Firestore with known values.
 * Uses REST API (no SDK required).
 *
 * Usage:
 *   node setup-test-room.js                    # Create test room with defaults
 *   node setup-test-room.js --bpm 120          # Set specific BPM
 *   node setup-test-room.js --scale c_diatonic # Set specific scale
 *   node setup-test-room.js --chord Cmaj7      # Set specific chord
 *   node setup-test-room.js --all              # Run all test scenarios
 */

const https = require('https');

// Configuration
const CONFIG = {
    projectId: 'scale-navigator-ensemble',
    testRoomId: 'scale-navigator-bridge-test',
    testRoomSlug: 'bridge-test'
};

// Default test values
const DEFAULTS = {
    bpm: 120,
    scaleData: 'c_diatonic',
    chordData: 'Cmaj7',
    roomName: 'Bridge Test Room',
    slug: CONFIG.testRoomSlug
};

// All test scenarios for --all flag
const TEST_SCENARIOS = [
    { name: 'Diatonic C', scaleData: 'c_diatonic', bpm: 120 },
    { name: 'Diatonic G', scaleData: 'g_diatonic', bpm: 100 },
    { name: 'Acoustic D', scaleData: 'd_acoustic', bpm: 90 },
    { name: 'Harmonic Minor E', scaleData: 'e_harmonic_minor', bpm: 140 },
    { name: 'Harmonic Major F', scaleData: 'f_harmonic_major', bpm: 85 },
    { name: 'Whole Tone G', scaleData: 'g_whole_tone', bpm: 110 },
    { name: 'Octatonic A', scaleData: 'a_octatonic', bpm: 130 },
    { name: 'Hexatonic B (no Ableton)', scaleData: 'b_hexatonic', bpm: 95 },
    { name: 'Sharp root C#', scaleData: 'cs_diatonic', bpm: 125 },
    { name: 'Flat root Bb', scaleData: 'bb_acoustic', bpm: 115 },
];

// ---------------------------------------------------------------------------
// Firestore REST API
// ---------------------------------------------------------------------------

function buildDocumentUrl() {
    return `https://firestore.googleapis.com/v1/projects/${CONFIG.projectId}/databases/(default)/documents/rooms/${CONFIG.testRoomId}`;
}

function toFirestoreValue(value) {
    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            return { integerValue: String(value) };
        }
        return { doubleValue: value };
    }
    if (typeof value === 'string') {
        return { stringValue: value };
    }
    if (typeof value === 'boolean') {
        return { booleanValue: value };
    }
    return { nullValue: null };
}

function toFirestoreDocument(data) {
    const fields = {};
    for (const [key, value] of Object.entries(data)) {
        fields[key] = toFirestoreValue(value);
    }
    return { fields };
}

function httpRequest(method, url, body = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: { 'Content-Type': 'application/json' }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', reject);
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function createOrUpdateRoom(roomData) {
    const url = buildDocumentUrl();
    const doc = toFirestoreDocument(roomData);

    try {
        // Try PATCH (update)
        await httpRequest('PATCH', url, doc);
        console.log(`✓ Updated room: ${CONFIG.testRoomId}`);
    } catch (err) {
        if (err.message.includes('404')) {
            // Document doesn't exist, create it
            // For create, we need to use the parent collection URL with documentId param
            const createUrl = `https://firestore.googleapis.com/v1/projects/${CONFIG.projectId}/databases/(default)/documents/rooms?documentId=${CONFIG.testRoomId}`;
            await httpRequest('POST', createUrl, doc);
            console.log(`✓ Created room: ${CONFIG.testRoomId}`);
        } else {
            throw err;
        }
    }
}

async function getRoom() {
    const url = buildDocumentUrl();
    try {
        const result = await httpRequest('GET', url);
        return result.data;
    } catch (err) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
    const args = process.argv.slice(2);
    const options = { ...DEFAULTS };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        switch (arg) {
            case '--bpm':
                options.bpm = parseInt(next, 10);
                i++;
                break;
            case '--scale':
                options.scaleData = next;
                i++;
                break;
            case '--chord':
                options.chordData = next;
                i++;
                break;
            case '--all':
                options.runAll = true;
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
            case '--status':
                options.showStatus = true;
                break;
            case '--delete':
                options.deleteRoom = true;
                break;
        }
    }

    return options;
}

function printHelp() {
    console.log(`
Setup Test Room for Scale Navigator Bridge

Usage:
  node setup-test-room.js [options]

Options:
  --bpm <number>      Set BPM (default: 120)
  --scale <string>    Set scaleData (default: c_diatonic)
  --chord <string>    Set chordData (default: Cmaj7)
  --all               Run through all test scenarios (interactive)
  --status            Show current room state
  --delete            Delete the test room
  --help, -h          Show this help

Examples:
  node setup-test-room.js
  node setup-test-room.js --bpm 95 --scale g_harmonic_minor
  node setup-test-room.js --all

Test Room:
  Document ID: ${CONFIG.testRoomId}
  Slug: ${CONFIG.testRoomSlug}
  Project: ${CONFIG.projectId}
`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runAllScenarios() {
    console.log('\n🧪 Running all test scenarios...\n');
    console.log('Each scenario will be applied with a 3-second pause.');
    console.log('Watch your Ableton session to verify changes.\n');
    console.log('Press Ctrl+C to stop.\n');

    for (const scenario of TEST_SCENARIOS) {
        console.log(`\n--- ${scenario.name} ---`);
        console.log(`  scaleData: ${scenario.scaleData}`);
        console.log(`  bpm: ${scenario.bpm}`);

        await createOrUpdateRoom({
            ...DEFAULTS,
            scaleData: scenario.scaleData,
            bpm: scenario.bpm
        });

        console.log('  Waiting 3 seconds...');
        await sleep(3000);
    }

    console.log('\n✓ All scenarios complete!\n');
}

async function showStatus() {
    console.log(`\nChecking room: ${CONFIG.testRoomId}\n`);

    const doc = await getRoom();
    if (!doc) {
        console.log('Room does not exist.');
        return;
    }

    console.log('Current state:');
    const fields = doc.fields || {};
    for (const [key, value] of Object.entries(fields)) {
        const v = value.integerValue || value.doubleValue || value.stringValue || value.booleanValue;
        console.log(`  ${key}: ${v}`);
    }
}

async function deleteRoom() {
    const url = buildDocumentUrl();
    try {
        await httpRequest('DELETE', url);
        console.log(`✓ Deleted room: ${CONFIG.testRoomId}`);
    } catch (err) {
        console.log(`Room does not exist or already deleted.`);
    }
}

async function main() {
    const options = parseArgs();

    console.log('Scale Navigator Bridge - Test Room Setup');
    console.log('========================================\n');

    if (options.showStatus) {
        await showStatus();
        return;
    }

    if (options.deleteRoom) {
        await deleteRoom();
        return;
    }

    if (options.runAll) {
        await runAllScenarios();
        return;
    }

    // Single update
    const roomData = {
        roomName: options.roomName,
        slug: options.slug,
        bpm: options.bpm,
        scaleData: options.scaleData,
        chordData: options.chordData,
        updatedAt: Date.now()
    };

    console.log('Setting room state:');
    console.log(`  bpm: ${roomData.bpm}`);
    console.log(`  scaleData: ${roomData.scaleData}`);
    console.log(`  chordData: ${roomData.chordData}`);
    console.log('');

    await createOrUpdateRoom(roomData);

    console.log(`\nConnect to this room in Ableton:`);
    console.log(`  Room slug: ${CONFIG.testRoomSlug}`);
    console.log(`  Document ID: ${CONFIG.testRoomId}`);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
