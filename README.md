# Scale Navigator Bridge (M4L)

A Max for Live device that syncs Ableton Live's **tempo and Scale Awareness** directly from a Firebase room — no MIDI routing required.

**Replaces Scale Awareness Bridge** for anyone using Scale Navigator rooms.

Works with:
- **Scale Navigator Dashboard** (web/mobile/plugin)
- **Ensemble Jammer** (networked ensemble performances)
- **LALORK Join App** (laptop orchestra portal)

## What It Does

| Room Field | Ableton Target | Method |
|------------|----------------|--------|
| `bpm` | Session tempo | `live.object` → `set tempo` |
| `scaleData` | Scale Awareness | `live.object` → `set root_note` + `set scale_name` |
| `chordData` / `chordInfo` | MIDI notes into the device's own track | `midiformat` → `midiout` |

## Architecture

```
Firestore room doc (public read)
         ↓
    node.script (polls every 2s)
         ↓
    ├─ parse scaleData → root + scale_class
    │        ↓
    │   live.object directly sets:
    │     • set tempo 120
    │     • set root_note 7        (G)
    │     • set scale_name Major
    │        ↓
    │   Ableton Scale Awareness updates
    │   (Push, Wavetable, scale-aware plugins all follow)
    │
    └─ resolve chord → MIDI voicing
             ↓
        midiformat → midiout
             ↓
        chord notes play through whatever
        instrument is on the same track
```

**No MIDI routing needed.** Tempo and scale go directly to Ableton's API; chord notes flow straight into the track the device sits on. Incoming track MIDI passes through untouched.

## Chord MIDI Output

The current chord sounds as sustained notes (held until the chord changes) through the instrument on the device's track. A **Play Chords** toggle on the device turns this off (all notes are released immediately).

Voicing resolution order:
1. `chordInfo.voicing` from the room doc — exact absolute-MIDI voicing, written by current Dashboard versions (Harmony Payload v2, includes custom chords)
2. Lookup of `chordData` in the bundled `chords_no_supersets.json` → `original_voicing` (rooms hosted by older Dashboard versions)
3. No match → chord is display-only, no notes

## Scale Class Mapping

Scale Navigator's 7 scale classes map to Ableton's scale names:

| Scale Navigator | Ableton Scale Name |
|-----------------|-------------------|
| diatonic | Major |
| acoustic | Melodic Minor |
| harmonic_minor | Harmonic Minor |
| harmonic_major | Harmonic Major |
| whole_tone | Whole Tone |
| octatonic | Half-whole Dim. |
| hexatonic | ⚠️ Not in Ableton |

**Note:** When hexatonic is selected in the room, the device displays a warning but doesn't change Ableton's scale (there's no equivalent).

## Installation

1. Copy `Scale Navigator Bridge.amxd` to your Ableton User Library:
   ```
   ~/Music/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect/
   ```
2. In Live, drag the device onto any MIDI track
3. Enter your room slug (e.g., `my-ensemble`) and click Connect

## Configuration

- **Room Code**: Room slug (e.g., `my-ensemble`) or Firestore document ID
- **Poll Interval**: 2 seconds (hardcoded; edit `firestore-bridge.js` to change)

## How It Works

1. `node.script` runs `firestore-bridge.js`
2. On connect, resolves room slug → document ID
3. Polls `https://firestore.googleapis.com/v1/projects/scale-navigator-ensemble/...`
4. Extracts `bpm`, `scaleData`, `chordData`, `chordInfo` from response
5. Parses `scaleData` (e.g., `"g_harmonic_minor"` → root 7, scale "Harmonic Minor")
6. Resolves the chord to a MIDI voicing (`chordInfo.voicing`, else bundled chord DB)
7. Sends to Max: `rootNote 7`, `scaleName "Harmonic Minor"`, `bpm 120`, `midiNote <pitch> <vel>` per chord note
8. Max routes tempo/scale to `live.object` and chord notes to `midiformat → midiout`

## UI

```
┌─────────────────────────────────────────────────────────┐
│  Scale Navigator Bridge                                 │
│  ┌────────────────┐  [Connect] [Stop]                  │
│  │ my-ensemble    │                                     │
│  └────────────────┘                                     │
│  BPM   120        Scale  G  Harmonic Minor             │
│  Chord Cmaj7                                            │
│  connected                                              │
│  [x] Play chords into track                             │
└─────────────────────────────────────────────────────────┘
```

## Firestore Document Structure

The device expects a document at `rooms/{roomCode}` with:
```json
{
  "bpm": 120,
  "scaleData": "g_harmonic_minor",
  "chordData": "Gmaj7"
}
```

## vs. Scale Awareness Bridge

| Feature | This Device | Scale Awareness Bridge |
|---------|-------------|------------------------|
| Input | Firebase polling | MIDI notes |
| Scale API | Direct `live.object` | MIDI → lookup → `live.object` |
| Setup | Drop in, enter room | Configure 2 MIDI outputs + routing |
| Hexatonic | Shows warning | UI goes stale (bug) |
| Real-time | ~2s latency | Instant (MIDI) |

Use this device for Firebase-connected workflows. Use Scale Awareness Bridge for local MIDI-based setups.

## Quota Considerations

- Firestore free tier: 50,000 reads/day
- Default poll rate (2s): ~43,200 reads/day per device
- For multi-device scenarios, consider increasing poll interval

## File Structure

```
├── Scale Navigator Bridge.amxd   # The M4L device
├── code/
│   ├── firestore-bridge.js       # Node script (polling + parsing + chord MIDI)
│   ├── chords_no_supersets.json  # Chord voicing DB (fallback for old rooms)
│   └── package.json
└── README.md
```

## Related

- [lalork-website#14](https://github.com/nathanturczan/lalork-website/issues/14) - Original tempo sync issue
- [lalork-website#34](https://github.com/nathanturczan/lalork-website/issues/34) - Expanded to full harmony
- [Scale Navigator Dashboard](https://github.com/nathanturczan/scale-navigator-dashboard)
- [Ensemble Jammer](https://github.com/nathanturczan/EnsembleJammer)
- [Live API - LOM](https://docs.cycling74.com/legacy/max8/vignettes/live_object_model)

## License

MIT
