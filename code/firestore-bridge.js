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
    pollInterval: 2000,       // ms
    enabled: false
};

// State
let lastBpm = null;
let lastScaleData = null;
let lastChordData = null;
let pollTimer = null;

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
    'acoustic': 'Melodic Minor',      // Ableton calls it "Melodic Minor"
    'harmonic_minor': 'Harmonic Minor',
    'harmonic_major': 'Harmonic Major',
    'whole_tone': 'Whole Tone',
    'octatonic': 'Half-whole Dim.',   // Ableton's name for octatonic
    'hexatonic': null                  // No Ableton equivalent
};

// Root number to name (for display)
const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Parse scaleData string (e.g., "g_harmonic_minor") into root and class
 * @returns {{ root: number, rootName: string, scaleClass: string, abletonScaleName: string|null }}
 */
function parseScaleData(scaleData) {
    if (!scaleData || typeof scaleData !== 'string') return null;

    // Format: "root_scaleclass" e.g., "g_harmonic_minor", "cs_diatonic", "bb_acoustic"
    const underscoreIndex = scaleData.indexOf('_');
    if (underscoreIndex === -1) return null;

    const rootStr = scaleData.substring(0, underscoreIndex).toLowerCase();
    const scaleClass = scaleData.substring(underscoreIndex + 1).toLowerCase();

    const root = ROOT_TO_MIDI[rootStr];
    if (root === undefined) {
        maxApi.post(`Unknown root: "${rootStr}"`);
        return null;
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

                // Send display info
                maxApi.outlet('rootName', parsed.rootName);
                maxApi.outlet('scaleClass', parsed.scaleClass);

                if (parsed.abletonScaleName !== null) {
                    // Send scale_name for live.object (exact Ableton string)
                    maxApi.outlet('scaleName', parsed.abletonScaleName);
                    maxApi.post(`Scale: ${parsed.rootName} ${parsed.abletonScaleName}`);
                } else {
                    // Hexatonic - no Ableton equivalent, send warning
                    maxApi.outlet('scaleName', '__hexatonic__');
                    maxApi.post(`Scale: ${parsed.rootName} hexatonic (not in Ableton)`);
                }
            }
        }

        // --- Chord Data ---
        const chordData = extractChordData(doc);
        if (chordData !== null && chordData !== lastChordData) {
            lastChordData = chordData;
            maxApi.outlet('chord', chordData);
            maxApi.post(`Chord: ${chordData}`);
        }

        maxApi.outlet('status', 'connected');
    } catch (err) {
        maxApi.outlet('status', 'error');
        maxApi.post(`Error: ${err.message}`);
    }
}

function startPolling() {
    stopPolling();
    if (config.roomCode) {
        config.enabled = true;
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
    lastBpm = null;
    lastScaleData = null;
    lastChordData = null;
    maxApi.outlet('status', 'disconnected');
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
        maxApi.outlet('status', 'error');
        return;
    }
    startPolling();
});

maxApi.addHandler('disconnect', () => {
    stopPolling();
    maxApi.post('Disconnected');
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
maxApi.outlet('status', 'ready');
