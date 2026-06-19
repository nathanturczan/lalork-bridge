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
| `chordData` | Display only | (Push, Wavetable, etc. follow Scale Awareness) |

## Architecture

```
Firestore room doc (public read)
         ↓
    node.script (polls every 2s)
         ↓
    parse scaleData → root + scale_class
         ↓
    live.object directly sets:
      • set tempo 120
      • set root_note 7        (G)
      • set scale_name Major
         ↓
    Ableton Scale Awareness updates
         ↓
    Push, Wavetable, scale-aware plugins all follow
```

**No MIDI routing needed.** This device talks directly to Ableton's API.

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
4. Extracts `bpm`, `scaleData`, `chordData` from response
5. Parses `scaleData` (e.g., `"g_harmonic_minor"` → root 7, scale "Harmonic Minor")
6. Sends to Max: `rootNote 7`, `scaleName "Harmonic Minor"`, `bpm 120`
7. Max routes to `live.object` which sets Ableton's properties directly

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
│   ├── firestore-bridge.js       # Node script (polling + parsing)
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
