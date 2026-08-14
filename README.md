# LA Laptop Orchestra Bridge (M4L)

A Max for Live device that syncs Ableton Live's **tempo and Scale Awareness** directly from a Firebase room — no MIDI routing required.

**The shipping device is `LA Laptop Orchestra Bridge.amxd` at the repo root** (frozen, self-contained). `Ensemble Bridge.amxd` and `Scale Navigator Bridge.amxd` are **legacy** — they use the old pre-Stack-White patch wiring and will not work against the current room protocol. Don't distribute them.

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
| `chordData` / `chordInfo` | Harmony palette for the played instrument (Chord / Root / Scale — selectable NoteSource) | incoming MIDI remapped → `midiformat` → `midiout` |

## Architecture

```
Firestore room doc (public read)
         ↓
    node.script (polls every 0.5s)
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
    └─ resolve chord → harmony palette
             ↓
        incoming MIDI notes remapped to palette
             ↓
        midiformat → midiout
             ↓
        played notes sound through whatever
        instrument is on the same track
```

**No MIDI routing needed.** Tempo and scale go directly to Ableton's API. The device is a **played instrument**: it remaps incoming MIDI notes (hardware keyboard or Live's Computer MIDI Keyboard) into the current harmony and sends them to the instrument on its track. No input, no sound.

## Playing (Stack White)

The mapping is Tonalign's **Stack White** algorithm: white keys select successive notes of a harmony palette, wrapping up an octave when the palette is exhausted; black keys are blocked (their note-ons and note-offs are dropped). Input MIDI 60 (the CMK's default A key) always plays the first palette note. Example — Cmaj7 palette `[36, 40, 43, 47]`, playing white keys upward from input 60 yields `36, 40, 43, 47, 48, 52, 55, 59, 60`. (Pitches below are MIDI note numbers; Live's display names them an octave lower than scientific pitch, e.g. MIDI 36 shows as C1.)

A **NoteSource** dropdown selects the palette, so you can put one instance on each of several tracks:

| NoteSource | Palette |
|------------|---------|
| **Chord** (default) | The current chord's pitch classes, ascending close position from the chord root (placed near MIDI 36) |
| **Root** | Bass zones: A S D play the chord root (near MIDI 24), F G H the chord tone nearest a perfect fifth above it (ties pick the higher tone), J K L the root an octave up; the pattern continues in both directions |
| **Scale** | The current scale's tones placed in a fixed MIDI 48–59 window, sorted ascending — anchored at C, **not** the scale root, so a parsimonious scale change moves as few keys as possible (shared tones stay on the same keys) |

Behavior details:
- Velocity is preserved; original incoming notes are suppressed; non-note MIDI (CC, bend, aftertouch) passes through
- When the harmony or NoteSource changes while notes are held, held notes are re-pitched immediately (note-offs first, velocities kept) — no stuck notes
- Note-offs always release the exact generated note, even after a harmony change; duplicate outputs are refcounted; CC 123 (All Notes Off) flushes everything
- Tempo and scale sync are unaffected by NoteSource — every instance sets them identically (idempotent), so multiple instances coexist as long as they're on **different tracks**

Chord palette resolution order:
1. `chordInfo` (root + voicing) from the room doc — written by current Dashboard versions (Harmony Payload v2, includes custom chords); the voicing's pitch classes are re-stacked close position from the root
2. Lookup of `chordData` in the chord DB inlined into `firestore-bridge.js` (rooms hosted by older Dashboard versions; regenerate with `scripts/inline-chord-db.py`)
3. No match → chord is display-only, playing produces no notes

## Scale Class Mapping

Scale Navigator's 7 scale classes map to Ableton's scale names:

| Scale Navigator | Ableton Scale Name |
|-----------------|-------------------|
| diatonic | Major |
| acoustic | Lydian Dominant |
| harmonic_minor | Harmonic Minor |
| harmonic_major | Harmonic Major |
| whole_tone | Whole Tone |
| octatonic | Half-whole Dim. |
| hexatonic | Messiaen 3 (superset) |

**Note:** Ableton has no hexatonic scale, and the scale list is not extensible (the LOM and the Extensions SDK only expose read-only scale properties). The device approximates it with Messiaen 3 at the same root: all 6 hexatonic pitches are contained in it, plus 3 extra notes.

## Installation

Use the **frozen** `LA Laptop Orchestra Bridge.amxd` at the repo root — it's fully self-contained (the node script and logo are embedded), so it works dragged straight from Downloads or Desktop with no loose files.

1. Drag it onto any MIDI track in Live
2. Pick a mode tab: **PERFORMANCE** or **REHEARSAL**
3. Click **JOIN LA LAPTOP ORCHESTRA** (performance) or enter a code and click **JOIN PRIVATE REHEARSAL**

Optionally copy it into your User Library so it shows up in Live's browser:
```
~/Music/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect/
```

## Configuration

**The device does not auto-connect.** It loads idle and stays idle until it receives a `room` message — the JS emits `loaded 1` after init so the patch never sends a room before handlers are registered. A gray `ENTER YOUR PRIVATE REHEARSAL CODE` banner on load is correct behavior, not a failure.

- **Room**: chosen at runtime. `mode_tab` (live.tab) selects `REHEARSAL` (0) or `PERFORMANCE` (1). Performance sends the literal `la-laptop-orchestra`; rehearsal sends whatever is committed in the `rehearsal_input` textedit, or a pick from the lobby menu (`refreshRooms` / `selectRoom`). The field accepts doc IDs, slugs, or friendly room names — case-insensitive, spaces OK.
- **Joining is global.** Mode and room are shared across every instance in the Set via `send`/`receive lalork-mode` and `lalork-room`, so joining on one track joins them all. The sender joins through its own receive.
- **No persistence.** Room codes do **not** save with a Live Set (`pattr room_code` is dangling and lacks `@parameter_enable`). Every load starts idle with an empty field, so performers must rejoin after every restart. Deliberate — see issue #29 before "fixing" it.
- **Poll Interval**: 0.5 seconds (hardcoded; edit `firestore-bridge.js` to change)

## How It Works

1. `node.script` runs `firestore-bridge.js`, which registers handlers and emits `loaded 1` — it stays **idle** until the patch sends a `room`
2. On `room`, resolves slug / friendly name / doc ID → document ID, and outlets `roomcode <code>` once per connection so every instance's field shows the room it is actually polling
3. Polls `https://firestore.googleapis.com/v1/projects/scale-navigator-ensemble/...`
4. Extracts `bpm`, `scaleData`, `chordData`, `chordInfo` from response
5. Parses `scaleData` (e.g., `"g_harmonic_minor"` → root 7, scale "Harmonic Minor")
6. Resolves the chord to a harmony palette (`chordInfo` root + voicing, else bundled chord DB)
7. Sends to Max: `rootNote 7`, `scaleName "Harmonic Minor"`, `bpm 120`; incoming MIDI notes arrive as `noteIn <pitch> <vel> <ch>` and come back as `midiNote <pitch> <vel>` remapped to the palette
8. Max routes tempo/scale to `live.object` and played notes to `midiformat → midiout`

## UI

```
┌─────────────────────────────────────────────────────────┐
│  LA Laptop Orchestra Bridge                             │
│  [ REHEARSAL | PERFORMANCE ]        <- mode_tab         │
│  BPM   120        Scale  C  Diatonic                    │
│  Chord Cmaj7                                            │
│  ┌─────────────────────────────────────────────────┐    │
│  │   ● PERFORMING — LA LAPTOP ORCHESTRA (purple)   │    │
│  └─────────────────────────────────────────────────┘    │
│  [ JOIN LA LAPTOP ORCHESTRA ]                           │
│  NoteSource: [Chord ▾]                                  │
└─────────────────────────────────────────────────────────┘
```

`mode_tab` switches which controls are visible via `thispatcher script show/hide`. Performance shows `performance_join`; rehearsal shows `rehearsal_label`, `rehearsal_input`, the lobby menu, and `rehearsal_join`.

The status banner is a full-width color block, readable from stage distance. **These are the exact strings in the shipping device** (verified against the frozen patcher, Aug 14 2026):

| State | Banner |
|-------|--------|
| Joined the performance room | purple — `● PERFORMING — LA LAPTOP ORCHESTRA` |
| Joined a private rehearsal room | green — `● REHEARSING — PRIVATE ROOM` |
| Connected (generic) | green — `● CONNECTED` |
| Connecting (first poll in flight) | amber — `connecting...` |
| Joining the performance room | amber — `JOINING LA LAPTOP ORCHESTRA...` |
| Poll failing (wifi down, room missing) | red — `✗ CHECK ROOM + WIFI` |
| Manually disconnected | gray — `disconnected` |
| Idle on load, nothing joined | gray — `ENTER YOUR PRIVATE REHEARSAL CODE` |

Status is emitted only on state *change*, so the banner switches instantly but the patch isn't hammered with messages every poll.

> **Known cosmetic bug (#33):** the `rehearse_url` / `enter_url` comments in the patch read `rehearse.laptoporchestra.com` and `enter.laptoporchestra.com` — missing the second `la`. Those domains do not resolve. The real addresses are `rehearse.lalaptoporchestra.com` and `enter.lalaptoporchestra.com`. Fixing it requires a refreeze.

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
| Real-time | ~0.5s latency | Instant (MIDI) |

Use this device for Firebase-connected workflows. Use Scale Awareness Bridge for local MIDI-based setups.

## Quota Considerations

- Firestore free tier: 50,000 reads/day — a **single instance** at the 0.5s poll rate burns that in ~7 hours (172,800 reads/day)
- Ensemble math: 10 laptops × 3 instances × 2 reads/s × 3h rehearsal ≈ 650k reads
- **The project should be on the Blaze plan** for real ensemble use; overage costs $0.06 per 100k reads (≈ $0.36 for the rehearsal above). Set a small budget alert.
- Future fix: replace polling with a Firestore streaming listener (1 read per change, ~100ms latency) — requires bundling the Firebase SDK into the script (e.g., esbuild) to keep the frozen device self-contained

## File Structure

```
├── LA Laptop Orchestra Bridge.amxd  # FROZEN, self-contained — THE DISTRIBUTABLE
├── Ensemble Bridge.amxd             # LEGACY, unfrozen, old patch wiring — do not ship
├── Scale Navigator Bridge.amxd      # LEGACY, unfrozen, old patch wiring — do not ship
├── dist/                            # frozen copies of the two legacy devices
├── firestore-bridge.js              # mirror of code/ (what an unfrozen device loads); keep byte-identical
├── code/
│   ├── firestore-bridge.js       # Node script — SOURCE OF TRUTH (polling + parsing + Stack White engine)
│   ├── chords_no_supersets.json  # Chord voicing DB source (inlined into the JS by scripts/inline-chord-db.py)
│   └── package.json
├── test/
│   ├── stack-white-test.js       # 18 checks incl. downbeat hold (#32)
│   └── roomcode-test.js          # 11 checks — #27 roomcode display protocol
└── README.md
```

### Development workflow

The shipping device is **frozen**, so it embeds a snapshot of `firestore-bridge.js` — **editing `code/` does nothing until it is refrozen**, and freezing is GUI-only. Full procedure and verification steps are in `CLAUDE.md` ("CRITICAL: Freeze workflow"). Run `node test/stack-white-test.js` and `node test/roomcode-test.js` after any JS change.

Where the download is served from: `lalork-rehearse/pieces/` (Vite `publicDir`), reachable at `rehearse.lalaptoporchestra.com/LA%20Laptop%20Orchestra%20Bridge.amxd`, and linked from Enter's ABLETON page as **Bridge Only**. The Ableton template zip embeds its own copy — **keep the two in sync** (they drifted once; the standalone was 9 days stale).

## Related

- [lalork-website#14](https://github.com/nathanturczan/lalork-website/issues/14) - Original tempo sync issue
- [lalork-website#34](https://github.com/nathanturczan/lalork-website/issues/34) - Expanded to full harmony
- [Scale Navigator Dashboard](https://github.com/nathanturczan/scale-navigator-dashboard)
- [Ensemble Jammer](https://github.com/nathanturczan/EnsembleJammer)
- [Live API - LOM](https://docs.cycling74.com/legacy/max8/vignettes/live_object_model)

## License

MIT
