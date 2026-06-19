# Testing Regimen: Scale Navigator Bridge

## Prerequisites

- [ ] Ableton Live 11+ with Max for Live
- [ ] Node.js bundled with Max 8+ (automatic)
- [ ] Active Firebase room with `bpm` and `scaleData` fields
- [ ] Push controller (optional, for Scale Awareness verification)

---

## Phase 1: Device Loading

### 1.1 Basic Load
- [ ] Open `Scale Navigator Bridge.amxd` in Max
- [ ] Verify no red error objects in patcher
- [ ] Check Max console for "Firestore Bridge loaded"
- [ ] Status display shows "ready"

### 1.2 Live Integration
- [ ] Drop device onto MIDI track in Ableton
- [ ] Device loads without errors
- [ ] Presentation view displays correctly (title, room input, buttons)

---

## Phase 2: Connection Tests

### 2.1 Room Resolution - Direct Document ID
```
Test room: Use a known Firestore document ID
```
- [ ] Enter document ID in room input
- [ ] Click Connect
- [ ] Max console shows: `Polling room "..." every 2000ms`
- [ ] Status changes to "connected"

### 2.2 Room Resolution - Slug Lookup
```
Test room: Use a room slug (e.g., "test-room")
```
- [ ] Enter slug in room input
- [ ] Click Connect
- [ ] Max console shows: `Resolved room "slug" to doc ID "..."`
- [ ] Status changes to "connected"

### 2.3 Invalid Room
- [ ] Enter nonexistent room code: `zzz-invalid-room-999`
- [ ] Click Connect
- [ ] Max console shows: `Error: Room "..." not found`
- [ ] Status changes to "error"

### 2.4 Disconnect
- [ ] While connected, click Stop
- [ ] Max console shows: `Disconnected`
- [ ] Status changes to "disconnected"
- [ ] Polling stops (no more console messages)

---

## Phase 3: BPM Sync

### 3.1 Initial BPM Load
- [ ] Connect to room with `bpm: 120`
- [ ] BPM display shows 120
- [ ] Ableton session tempo changes to 120

### 3.2 BPM Change Detection
```
In Firebase Console or Dashboard, change room bpm to 95
```
- [ ] Wait up to 2 seconds
- [ ] Max console shows: `BPM: 95`
- [ ] BPM display updates to 95
- [ ] Ableton session tempo changes to 95

### 3.3 BPM Deduplication
```
Set room bpm to same value it already is
```
- [ ] No console message (no duplicate send)
- [ ] Ableton tempo unchanged

### 3.4 BPM Edge Cases
| Test | Room Value | Expected |
|------|------------|----------|
| Integer | `bpm: 140` | Tempo = 140 |
| Float | `bpm: 127.5` | Tempo = 127.5 |
| String (legacy) | `bpm: "110"` | Tempo = 110 |
| Missing | No `bpm` field | No change |

---

## Phase 4: Scale Awareness

### 4.1 Diatonic Scale
```
Set room scaleData: "c_diatonic"
```
- [ ] Max console shows: `Scale: C Major`
- [ ] Root display shows "C"
- [ ] Scale display shows "Major"
- [ ] Ableton Scale Awareness: Root = C, Scale = Major
- [ ] Push pads light up in C Major pattern (if connected)

### 4.2 All Scale Classes
Test each scale class maps correctly:

| scaleData | Expected Root | Expected Scale | Ableton Scale Name |
|-----------|---------------|----------------|-------------------|
| `c_diatonic` | C (0) | diatonic | Major |
| `d_acoustic` | D (2) | acoustic | Melodic Minor |
| `e_harmonic_minor` | E (4) | harmonic_minor | Harmonic Minor |
| `f_harmonic_major` | F (5) | harmonic_major | Harmonic Major |
| `g_whole_tone` | G (7) | whole_tone | Whole Tone |
| `a_octatonic` | A (9) | octatonic | Half-whole Dim. |
| `b_hexatonic` | B (11) | hexatonic | ⚠️ Warning |

### 4.3 Hexatonic (No Ableton Equivalent)
```
Set room scaleData: "c_hexatonic"
```
- [ ] Max console shows: `Scale: C hexatonic (not in Ableton)`
- [ ] Root display shows "C"
- [ ] Scale display shows "Hexatonic (not in Ableton)"
- [ ] Ableton Scale Awareness **unchanged** (stays on previous scale)

### 4.4 All Root Notes
Test root parsing for all pitch classes:

| scaleData prefix | Expected Root |
|------------------|---------------|
| `c_` | C (0) |
| `cs_` | C# (1) |
| `db_` | Db (1) |
| `d_` | D (2) |
| `ds_` | D# (3) |
| `eb_` | Eb (3) |
| `e_` | E (4) |
| `f_` | F (5) |
| `fs_` | F# (6) |
| `gb_` | Gb (6) |
| `g_` | G (7) |
| `gs_` | G# (8) |
| `ab_` | Ab (8) |
| `a_` | A (9) |
| `as_` | A# (10) |
| `bb_` | Bb (10) |
| `b_` | B (11) |

### 4.5 Scale Change Detection
```
Change room scaleData from "c_diatonic" to "g_harmonic_minor"
```
- [ ] Wait up to 2 seconds
- [ ] Root display changes C → G
- [ ] Scale display changes Major → Harmonic Minor
- [ ] Ableton Scale Awareness updates
- [ ] Push pads update (if connected)

### 4.6 Scale Deduplication
```
Set scaleData to same value it already is
```
- [ ] No console message (no duplicate send)
- [ ] Ableton unchanged

---

## Phase 5: Chord Display

### 5.1 Chord Update
```
Set room chordData: "Cmaj7"
```
- [ ] Chord display shows "Cmaj7"
- [ ] Max console shows: `Chord: Cmaj7`

### 5.2 Chord Change
```
Change room chordData: "Am9"
```
- [ ] Chord display updates to "Am9"

### 5.3 Missing Chord
```
Room has no chordData field
```
- [ ] Chord display stays empty (no crash)

---

## Phase 6: Error Handling

### 6.1 Network Error
- [ ] Disconnect from internet
- [ ] Wait for next poll cycle
- [ ] Status shows "error"
- [ ] Max console shows error message
- [ ] Reconnect to internet
- [ ] Next poll succeeds, status returns to "connected"

### 6.2 Room Deleted
```
Delete the room document in Firebase Console
```
- [ ] Next poll shows error
- [ ] Status changes to "error"
- [ ] Console: `Room "..." not found`

### 6.3 Malformed scaleData
```
Set room scaleData to invalid values
```
| scaleData | Expected Behavior |
|-----------|-------------------|
| `"invalid"` | Console: `Unknown root`, no crash |
| `"x_diatonic"` | Console: `Unknown root: "x"` |
| `"c_unknown"` | Console: `Unknown scale class: "unknown"` |
| `""` | Ignored, no crash |
| `null` | Ignored, no crash |

---

## Phase 7: UI Verification

### 7.1 Presentation Mode
- [ ] All elements visible in device chain
- [ ] Room input accepts text
- [ ] Connect/Stop buttons clickable
- [ ] BPM display readable
- [ ] Scale display readable
- [ ] Status text visible

### 7.2 Device Width
- [ ] Device fits in standard device chain width (~200px)
- [ ] No horizontal scrolling needed

---

## Phase 8: Integration Tests

### 8.1 Dashboard → Bridge → Ableton
```
1. Open Scale Navigator Dashboard
2. Create/join a room
3. In Ableton, load Scale Navigator Bridge
4. Connect to same room
5. Change scale in Dashboard
```
- [ ] Ableton Scale Awareness follows Dashboard within ~2s
- [ ] Tempo follows Dashboard within ~2s

### 8.2 Ensemble Jammer → Bridge → Ableton
```
Same test with Ensemble Jammer as the source
```
- [ ] Scale Awareness follows room state

### 8.3 Multiple Devices
```
Load Scale Navigator Bridge on two different MIDI tracks
Connect both to same room
```
- [ ] Both devices show same state
- [ ] No conflicts or errors

---

## Phase 9: Performance

### 9.1 Long-Running Session
- [ ] Leave device connected for 30+ minutes
- [ ] No memory leaks (check Max console)
- [ ] Polling continues reliably
- [ ] No accumulating errors

### 9.2 Rapid Changes
```
Change room state rapidly (every 1 second)
```
- [ ] Device handles rapid updates
- [ ] No dropped updates
- [ ] Ableton stays in sync

---

## Phase 10: Edge Cases

### 10.1 Connect Without Room Code
- [ ] Click Connect with empty room input
- [ ] Console: `Cannot connect: no room code set`
- [ ] Status: "error"

### 10.2 Change Room While Connected
- [ ] Connect to room A
- [ ] Type new room slug in input
- [ ] Press Enter/Return
- [ ] Device switches to room B
- [ ] Console shows new room resolution

### 10.3 Reconnect After Stop
- [ ] Connect → Stop → Connect
- [ ] Device resumes polling
- [ ] State syncs correctly

---

## Test Results Template

```
Date: ____________________
Tester: __________________
Ableton Version: _________
Max Version: _____________
macOS Version: ___________

Phase 1: [ ] Pass  [ ] Fail  Notes: _______________
Phase 2: [ ] Pass  [ ] Fail  Notes: _______________
Phase 3: [ ] Pass  [ ] Fail  Notes: _______________
Phase 4: [ ] Pass  [ ] Fail  Notes: _______________
Phase 5: [ ] Pass  [ ] Fail  Notes: _______________
Phase 6: [ ] Pass  [ ] Fail  Notes: _______________
Phase 7: [ ] Pass  [ ] Fail  Notes: _______________
Phase 8: [ ] Pass  [ ] Fail  Notes: _______________
Phase 9: [ ] Pass  [ ] Fail  Notes: _______________
Phase 10: [ ] Pass  [ ] Fail  Notes: ______________

Overall: [ ] Ready for Release  [ ] Needs Fixes
```

---

## Quick Smoke Test (5 minutes)

For rapid validation:

1. [ ] Load device in Ableton
2. [ ] Enter known room slug
3. [ ] Click Connect → status shows "connected"
4. [ ] BPM display matches room
5. [ ] Scale display matches room
6. [ ] Change scale in Dashboard → Ableton updates within 3s
7. [ ] Click Stop → status shows "disconnected"

If all pass, device is functional.
