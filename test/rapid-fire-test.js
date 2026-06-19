#!/usr/bin/env node
/**
 * Rapid Fire Test - Scale Navigator Bridge
 *
 * Cycles through scale/BPM changes rapidly to test:
 * - Polling reliability
 * - Deduplication
 * - UI responsiveness
 * - Ableton sync stability
 *
 * Usage:
 *   node rapid-fire-test.js              # Default: 2s intervals, 20 cycles
 *   node rapid-fire-test.js --fast       # 1s intervals
 *   node rapid-fire-test.js --cycles 50  # Custom cycle count
 */

const https = require('https');

const CONFIG = {
    projectId: 'scale-navigator-ensemble',
    testRoomId: 'scale-navigator-bridge-test'
};

const SCALES = [
    'c_diatonic', 'g_diatonic', 'd_acoustic', 'a_harmonic_minor',
    'e_harmonic_major', 'b_whole_tone', 'fs_octatonic', 'bb_diatonic',
    'eb_acoustic', 'ab_harmonic_minor', 'db_harmonic_major', 'f_diatonic'
];

const CHORDS = [
    'Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bm7b5',
    'Cmaj9', 'Dm9', 'G13', 'Fmaj7#11', 'Am11'
];

function randomBpm() {
    return Math.floor(Math.random() * 80) + 60; // 60-140
}

function randomScale() {
    return SCALES[Math.floor(Math.random() * SCALES.length)];
}

function randomChord() {
    return CHORDS[Math.floor(Math.random() * CHORDS.length)];
}

function toFirestoreValue(value) {
    if (typeof value === 'number') {
        return Number.isInteger(value)
            ? { integerValue: String(value) }
            : { doubleValue: value };
    }
    return { stringValue: value };
}

function httpPatch(url, fields) {
    return new Promise((resolve, reject) => {
        const body = { fields: {} };
        for (const [k, v] of Object.entries(fields)) {
            body.fields[k] = toFirestoreValue(v);
        }

        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode }));
        });
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    const args = process.argv.slice(2);
    let interval = 2000;
    let cycles = 20;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--fast') interval = 1000;
        if (args[i] === '--cycles') cycles = parseInt(args[i + 1], 10);
    }

    const url = `https://firestore.googleapis.com/v1/projects/${CONFIG.projectId}/databases/(default)/documents/rooms/${CONFIG.testRoomId}`;

    console.log('Rapid Fire Test - Scale Navigator Bridge');
    console.log('========================================');
    console.log(`Interval: ${interval}ms`);
    console.log(`Cycles: ${cycles}`);
    console.log(`Room: ${CONFIG.testRoomId}`);
    console.log('');
    console.log('Watch Ableton for changes. Press Ctrl+C to stop.');
    console.log('');

    let successCount = 0;
    let errorCount = 0;

    for (let i = 1; i <= cycles; i++) {
        const bpm = randomBpm();
        const scale = randomScale();
        const chord = randomChord();

        process.stdout.write(`[${i}/${cycles}] bpm=${bpm}, scale=${scale}, chord=${chord}...`);

        try {
            await httpPatch(url, { bpm, scaleData: scale, chordData: chord });
            console.log(' ✓');
            successCount++;
        } catch (err) {
            console.log(` ✗ ${err.message}`);
            errorCount++;
        }

        if (i < cycles) {
            await sleep(interval);
        }
    }

    console.log('');
    console.log('========================================');
    console.log(`Complete: ${successCount} success, ${errorCount} errors`);

    // Reset to known state
    console.log('');
    console.log('Resetting to default state...');
    await httpPatch(url, { bpm: 120, scaleData: 'c_diatonic', chordData: 'Cmaj7' });
    console.log('Done.');
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
