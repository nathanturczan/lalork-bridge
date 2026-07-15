/**
 * Scale Navigator Bridge - Firestore to Ableton
 *
 * Polls a Firestore room document for tempo and harmonic state.
 * Sends data to Max for direct live.object control of:
 *   - Session tempo
 *   - Scale Awareness (root_note + scale_name)
 *
 * Replaces Scale Awareness Bridge for Firebase-connected workflows.
 * Uses Firestore REST API (no SDK required, public-read documents only).
 */

const maxApi = require('max-api');
const https = require('https');

// Configuration (set via Max messages)
let config = {
    projectId: 'scale-navigator-ensemble',
    roomCode: null,           // slug or document ID
    resolvedDocId: null,      // actual Firestore document ID
    pollInterval: 500,        // ms
    enabled: false
};

// State
let lastBpm = null;
let lastScaleData = null;
let lastChordData = null;
let lastStatus = null;
let pollTimer = null;

// Emit status to the UI banner only when it changes (poll runs every 500ms)
function setStatus(s) {
    if (s === lastStatus) return;
    lastStatus = s;
    maxApi.outlet('status', s);
}

// MIDI output state
let playChords = true;          // toggled from Max UI (gates all note output)
let heldNotes = [];             // notes currently sounding (need note-offs)
let currentChordNotes = null;   // voicing of the current chord
let currentChordRoot = null;    // pitch class (0-11) of the current chord root
let currentScalePcs = null;     // pitch classes (0-11) of the current scale
const NOTE_VELOCITY = 96;

// Output mode: what this instance plays into its track.
// Matches the Dashboard's MIDI output types.
const OUTPUT_MODES = ['Chord Voicing', 'Chord Root', 'Scale Notes'];
let outputMode = 0;             // 0 = chord voicing, 1 = chord root, 2 = scale pitch classes
const CHORD_ROOT_OFFSET = 24;   // chord root pc normalized two octaves up (MIDI 24-35)
const SCALE_PC_OFFSET = 36;     // scale pcs normalized three octaves up (MIDI 36-47)

// ---------------------------------------------------------------------------
// Scale Navigator → Ableton Scale Mapping
// ---------------------------------------------------------------------------

// Pitch class name to MIDI note number (0-11)
const ROOT_TO_MIDI = {
    'c': 0, 'cs': 1, 'db': 1, 'd': 2, 'ds': 3, 'eb': 3,
    'e': 4, 'fb': 4, 'f': 5, 'fs': 6, 'gb': 6, 'g': 7,
    'gs': 8, 'ab': 8, 'a': 9, 'as': 10, 'bb': 10, 'b': 11
};

// Scale Navigator scale class → Ableton scale name (exact strings required by live.object)
// These are the 7 scale classes from the 57-scale network
const SCALE_CLASS_TO_ABLETON_NAME = {
    'diatonic': 'Major',
    'acoustic': 'Lydian Dominant',    // same root: c_acoustic = C Lydian Dominant (4th mode of G mel. min.)
    'harmonic_minor': 'Harmonic Minor',
    'harmonic_major': 'Harmonic Major',
    'whole_tone': 'Whole Tone',
    'octatonic': 'Half-whole Dim.',   // Ableton's name for octatonic
    'hexatonic': 'Messiaen 3'          // No exact equivalent; hexatonic is a subset of Messiaen 3 at the same root
};

// Scale class → display name shown on the device (Scale Navigator vocabulary)
const SCALE_CLASS_DISPLAY = {
    'diatonic': 'Diatonic',
    'acoustic': 'Acoustic',
    'harmonic_minor': 'Harmonic Minor',
    'harmonic_major': 'Harmonic Major',
    'whole_tone': 'Whole Tone',
    'octatonic': 'Octatonic',
    'hexatonic': 'Hexatonic'
};

// Symmetric scales have no root prefix in scaleData; the transposition number
// implies the root (matches ScaleData.js in the Dashboard)
const SYMMETRIC_SCALE_ROOTS = {
    'whole_tone_1': 0, 'whole_tone_2': 1,
    'octatonic_1': 0, 'octatonic_2': 1, 'octatonic_3': 2,
    'hexatonic_1': 1, 'hexatonic_2': 2, 'hexatonic_3': 3, 'hexatonic_4': 4
};

// Scale class → intervals relative to root (from the Dashboard's ScaleData.js)
const SCALE_CLASS_INTERVALS = {
    'diatonic': [0, 2, 4, 5, 7, 9, 11],
    'acoustic': [0, 2, 4, 6, 7, 9, 10],
    'harmonic_minor': [0, 2, 3, 5, 7, 8, 11],
    'harmonic_major': [0, 2, 4, 5, 7, 8, 11],
    'whole_tone': [0, 2, 4, 6, 8, 10],
    'octatonic': [0, 1, 3, 4, 6, 7, 9, 10],   // half-whole
    'hexatonic': [0, 3, 4, 7, 8, 11]
};

// Root number to name (for display)
const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Parse scaleData string (e.g., "g_harmonic_minor") into root and class
 * @returns {{ root: number, rootName: string, scaleClass: string, abletonScaleName: string|null }}
 */
function parseScaleData(scaleData) {
    if (!scaleData || typeof scaleData !== 'string') return null;

    const key = scaleData.toLowerCase();
    let root, scaleClass;

    if (SYMMETRIC_SCALE_ROOTS[key] !== undefined) {
        // Symmetric scale: "octatonic_1", "whole_tone_2", "hexatonic_4"
        root = SYMMETRIC_SCALE_ROOTS[key];
        scaleClass = key.replace(/_\d+$/, '');
    } else {
        // Format: "root_scaleclass" e.g., "g_harmonic_minor", "cs_diatonic", "bb_acoustic"
        const underscoreIndex = key.indexOf('_');
        if (underscoreIndex === -1) return null;

        const rootStr = key.substring(0, underscoreIndex);
        scaleClass = key.substring(underscoreIndex + 1);

        root = ROOT_TO_MIDI[rootStr];
        if (root === undefined) {
            maxApi.post(`Unknown root: "${rootStr}"`);
            return null;
        }
    }

    const abletonScaleName = SCALE_CLASS_TO_ABLETON_NAME[scaleClass];
    if (abletonScaleName === undefined) {
        maxApi.post(`Unknown scale class: "${scaleClass}"`);
        return null;
    }

    const rootName = ROOT_NAMES[root];
    return { root, rootName, scaleClass, abletonScaleName };
}

// ---------------------------------------------------------------------------
// Chord → MIDI Notes
// ---------------------------------------------------------------------------

// Fallback chord database (chordData id → voicing). Loaded lazily; only needed
// for rooms written by older Dashboard versions that don't include chordInfo.
let chordDb = null;
function lookupChordVoicing(chordData) {
    if (chordDb === null) {
        try {
            chordDb = require('./chords_no_supersets.json');
        } catch (e) {
            maxApi.post('Warning: chords_no_supersets.json not found; chord MIDI needs chordInfo from the room');
            chordDb = {};
        }
    }
    const entry = chordDb[chordData];
    if (entry && Array.isArray(entry.original_voicing) && entry.original_voicing.length > 0) {
        return entry.original_voicing;
    }
    return null;
}

/**
 * Resolve the MIDI voicing for the current chord.
 * Priority: room's chordInfo.voicing (exact, supports custom chords)
 *           → bundled chord DB original_voicing
 *           → null (display-only)
 */
function resolveChordNotes(doc, chordData) {
    const chordInfoVoicing = extractChordInfoVoicing(doc);
    if (chordInfoVoicing) return chordInfoVoicing;
    return lookupChordVoicing(chordData);
}

/**
 * Resolve the pitch class (0-11) of the current chord's root.
 * Priority: chordInfo.root from the room doc → chord symbol prefix ("a_m7-13" → 9)
 */
function resolveChordRoot(doc, chordData) {
    const infoRoot = extractChordInfoRoot(doc);
    if (infoRoot !== null) return infoRoot;
    if (typeof chordData === 'string') {
        const underscoreIndex = chordData.indexOf('_');
        if (underscoreIndex > 0) {
            const root = ROOT_TO_MIDI[chordData.substring(0, underscoreIndex).toLowerCase()];
            if (root !== undefined) return root;
        }
    }
    return null;
}

function sendNoteOffs() {
    for (const note of heldNotes) {
        maxApi.outlet('midiNote', note, 0);
    }
    heldNotes = [];
}

/**
 * Notes to sound for the current output mode.
 */
function currentOutputNotes() {
    switch (outputMode) {
        case 1:  // chord root, normalized two octaves up
            return currentChordRoot !== null ? [currentChordRoot + CHORD_ROOT_OFFSET] : null;
        case 2:  // scale pitch classes, normalized three octaves up
            return currentScalePcs ? currentScalePcs.map(pc => pc + SCALE_PC_OFFSET) : null;
        default: // chord voicing (absolute MIDI)
            return currentChordNotes;
    }
}

function refreshOutput() {
    sendNoteOffs();
    const notes = currentOutputNotes();
    if (!playChords || !notes) return;
    for (const note of notes) {
        maxApi.outlet('midiNote', note, NOTE_VELOCITY);
    }
    heldNotes = notes.slice();
}

// ---------------------------------------------------------------------------
// Firestore REST API
// ---------------------------------------------------------------------------

function buildFirestoreUrl(docId) {
    if (!docId) return null;
    return `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/rooms/${docId}`;
}

function buildQueryUrl() {
    return `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents:runQuery`;
}

function httpGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        }).on('error', reject);
    });
}

function httpPost(url, body) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

async function resolveRoomId(slugOrId) {
    // 1. Try direct document ID lookup
    const directUrl = buildFirestoreUrl(slugOrId);
    const directRes = await httpGet(directUrl);
    if (directRes.status === 200) {
        return slugOrId;
    }

    // 2. Query by slug field
    const queryBody = {
        structuredQuery: {
            from: [{ collectionId: 'rooms' }],
            where: {
                fieldFilter: {
                    field: { fieldPath: 'slug' },
                    op: 'EQUAL',
                    value: { stringValue: slugOrId }
                }
            },
            limit: 1
        }
    };
    const queryRes = await httpPost(buildQueryUrl(), queryBody);
    if (queryRes.status === 200) {
        try {
            const results = JSON.parse(queryRes.data);
            if (results.length > 0 && results[0].document) {
                // Extract doc ID from document name path
                const docName = results[0].document.name;
                const docId = docName.split('/').pop();
                return docId;
            }
        } catch (e) {
            // Query failed, fall through
        }
    }

    return null;
}

async function fetchRoomDocument() {
    if (!config.roomCode) {
        throw new Error('No room code set');
    }

    // Resolve slug to doc ID on first call or if room changed
    if (!config.resolvedDocId) {
        config.resolvedDocId = await resolveRoomId(config.roomCode);
        if (!config.resolvedDocId) {
            throw new Error(`Room "${config.roomCode}" not found`);
        }
        maxApi.post(`Resolved room "${config.roomCode}" to doc ID "${config.resolvedDocId}"`);
    }

    const url = buildFirestoreUrl(config.resolvedDocId);
    const res = await httpGet(url);

    if (res.status === 200) {
        return JSON.parse(res.data);
    } else if (res.status === 404) {
        // Room was deleted? Clear cache and retry resolution next poll
        config.resolvedDocId = null;
        throw new Error(`Room "${config.roomCode}" not found`);
    } else {
        throw new Error(`HTTP ${res.status}`);
    }
}

/**
 * Extract a field value from Firestore REST response
 * Firestore wraps values: { "integerValue": "120" } or { "stringValue": "foo" }
 */
function extractFieldValue(field) {
    if (!field) return null;
    if (field.integerValue !== undefined) return parseInt(field.integerValue, 10);
    if (field.doubleValue !== undefined) return parseFloat(field.doubleValue);
    if (field.stringValue !== undefined) return field.stringValue;
    if (field.booleanValue !== undefined) return field.booleanValue;
    return null;
}

function extractBpm(doc) {
    const fields = doc.fields;
    if (!fields || !fields.bpm) return null;
    return extractFieldValue(fields.bpm);
}

function extractScaleData(doc) {
    const fields = doc.fields;
    if (!fields || !fields.scaleData) return null;
    return extractFieldValue(fields.scaleData);
}

function extractChordData(doc) {
    const fields = doc.fields;
    if (!fields || !fields.chordData) return null;
    return extractFieldValue(fields.chordData);
}

/**
 * Extract chordInfo.voicing (array of absolute MIDI notes) from the room doc.
 * Written by Dashboard "Harmony Payload v2" alongside chordData.
 */
function extractChordInfoVoicing(doc) {
    try {
        const values = doc.fields.chordInfo.mapValue.fields.voicing.arrayValue.values;
        const notes = values
            .map(v => extractFieldValue(v))
            .filter(n => typeof n === 'number' && n >= 0 && n <= 127);
        return notes.length > 0 ? notes : null;
    } catch (e) {
        return null;
    }
}

/**
 * Extract chordInfo.root (pitch class 0-11) from the room doc, if present.
 */
function extractChordInfoRoot(doc) {
    try {
        const root = extractFieldValue(doc.fields.chordInfo.mapValue.fields.root);
        if (typeof root === 'number' && root >= 0 && root <= 11) return root;
        return null;
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Polling Logic
// ---------------------------------------------------------------------------

async function poll() {
    if (!config.enabled || !config.roomCode) return;

    try {
        const doc = await fetchRoomDocument();

        // --- BPM ---
        const bpm = extractBpm(doc);
        if (bpm !== null && bpm !== lastBpm) {
            lastBpm = bpm;
            maxApi.outlet('bpm', bpm);
            maxApi.post(`BPM: ${bpm}`);
        }

        // --- Scale Data → Direct to Ableton Scale Awareness ---
        const scaleData = extractScaleData(doc);
        if (scaleData !== null && scaleData !== lastScaleData) {
            lastScaleData = scaleData;
            const parsed = parseScaleData(scaleData);

            if (parsed) {
                // Send root_note for live.object (0-11)
                maxApi.outlet('rootNote', parsed.root);

                // Send display info (Scale Navigator vocabulary)
                maxApi.outlet('rootName', parsed.rootName);
                const display = SCALE_CLASS_DISPLAY[parsed.scaleClass] || parsed.scaleClass;
                maxApi.outlet('scaleClass', display);

                // Send scale_name for live.object (exact Ableton string)
                maxApi.outlet('scaleName', parsed.abletonScaleName);
                const approx = parsed.scaleClass === 'hexatonic' ? ' (superset approximation)' : '';
                maxApi.post(`Scale: ${parsed.rootName} ${display} → Ableton ${parsed.abletonScaleName}${approx}`);

                // Cache scale pitch classes for Scale Notes output mode
                const intervals = SCALE_CLASS_INTERVALS[parsed.scaleClass];
                currentScalePcs = intervals
                    ? intervals.map(iv => (parsed.root + iv) % 12).sort((a, b) => a - b)
                    : null;
                if (outputMode === 2) refreshOutput();
            }
        }

        // --- Chord Data → display + MIDI notes into the track ---
        const chordData = extractChordData(doc);
        if (chordData !== null && chordData !== lastChordData) {
            lastChordData = chordData;
            maxApi.outlet('chord', chordData);

            currentChordNotes = resolveChordNotes(doc, chordData);
            currentChordRoot = resolveChordRoot(doc, chordData);
            if (outputMode !== 2) refreshOutput();
            if (currentChordNotes) {
                maxApi.post(`Chord: ${chordData} → notes [${currentChordNotes.join(' ')}]`);
            } else {
                maxApi.post(`Chord: ${chordData} (no voicing found, display only)`);
            }
        }

        setStatus('connected');
    } catch (err) {
        setStatus('error');
        maxApi.post(`Error: ${err.message}`);
    }
}

function startPolling() {
    stopPolling();
    if (config.roomCode) {
        config.enabled = true;
        setStatus('ready');  // banner shows "connecting..." until first poll lands
        poll();  // Immediate first poll
        pollTimer = setInterval(poll, config.pollInterval);
        maxApi.post(`Polling room "${config.roomCode}" every ${config.pollInterval}ms`);
    }
}

function stopPolling() {
    config.enabled = false;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    sendNoteOffs();
    currentChordNotes = null;
    currentChordRoot = null;
    currentScalePcs = null;
    lastBpm = null;
    lastScaleData = null;
    lastChordData = null;
}

// ---------------------------------------------------------------------------
// Max Message Handlers
// ---------------------------------------------------------------------------

maxApi.addHandler('room', (roomCode) => {
    config.roomCode = roomCode;
    config.resolvedDocId = null;  // Clear cached doc ID for re-resolution
    maxApi.post(`Room code set to "${roomCode}"`);
    if (config.enabled) {
        startPolling();  // Restart with new room
    }
});

maxApi.addHandler('project', (projectId) => {
    config.projectId = projectId;
    maxApi.post(`Project ID set to "${projectId}"`);
});

maxApi.addHandler('interval', (ms) => {
    config.pollInterval = Math.max(500, parseInt(ms, 10));  // Min 500ms
    maxApi.post(`Poll interval set to ${config.pollInterval}ms`);
    if (config.enabled) {
        startPolling();  // Restart with new interval
    }
});

maxApi.addHandler('connect', () => {
    if (!config.roomCode) {
        maxApi.post('Cannot connect: no room code set');
        setStatus('error');
        return;
    }
    startPolling();
});

maxApi.addHandler('disconnect', () => {
    stopPolling();
    setStatus('disconnected');
    maxApi.post('Disconnected');
});

// Note output on/off (from device toggle). Default on.
maxApi.addHandler('playChords', (val) => {
    const on = !!parseFloat(val);
    if (on === playChords) return;
    playChords = on;
    if (on) {
        refreshOutput();  // resume current mode's notes
        maxApi.post('Note output: on');
    } else {
        sendNoteOffs();
        maxApi.post('Note output: off');
    }
});

// Output mode (from device dropdown): 0 = chord voicing, 1 = chord root, 2 = scale notes
maxApi.addHandler('mode', (m) => {
    const mode = parseInt(m, 10);
    if (isNaN(mode) || mode < 0 || mode >= OUTPUT_MODES.length || mode === outputMode) return;
    outputMode = mode;
    maxApi.post(`Output mode: ${OUTPUT_MODES[mode]}`);
    refreshOutput();
});

// Manual poll (for testing)
maxApi.addHandler('poll', () => {
    poll();
});

// Report current config
maxApi.addHandler('info', () => {
    maxApi.post(`Config: room=${config.roomCode}, project=${config.projectId}, interval=${config.pollInterval}ms, enabled=${config.enabled}`);
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

maxApi.post('Firestore Bridge loaded');
setStatus('ready');

// This device is dedicated to the LA Laptop Orchestra: connect immediately.
// (The 'room' handler still works for retargeting during testing.)
const DEFAULT_ROOM = 'la-laptop-orchestra';
config.roomCode = DEFAULT_ROOM;
startPolling();
