# Scale Navigator Bridge / Ensemble Bridge (M4L) — Project Notes

## Two devices, one JS

Both devices share `code/firestore-bridge.js` (which no longer auto-connects;
it stays `idle` until it receives a `room <code>` message, and any room
message auto-connects):

- `Scale Navigator Bridge.amxd` (repo root) — dedicated LALORK build. The
  patch sends `room la-laptop-orchestra` when the script reports `loaded`.
- `Ensemble Bridge.amxd` (repo root) — generic product build. Room code
  textedit (`room_field`) persisted with the Live set via
  `pattr room_code @bindto room_field @parameter_enable 1`; on `loaded` a
  `t b` bangs the textedit to re-deliver the restored room code. Status
  select includes `idle` → "enter a room code above" banner.
  Lobby: umenu + refresh button → `refreshRooms` (JS lists the public
  `rooms` collection, outlets `rooms clear/append <roomName>`, most recently
  updated first) and picking an item sends `selectRoom <index>`; the JS
  connects by doc ID and outlets `roomcode <name>` which is `set` into the
  textedit (so the pick persists with the set). The room field accepts doc
  IDs, slugs, OR roomNames (case-insensitive; spaces OK — `room` handler
  joins args).

The JS emits `loaded 1` after init (routed as the last `route` selector) so
the patch never sends the room code before handlers are registered.

## CRITICAL: Refreeze workflow (the distributables are FROZEN)

`dist/*.amxd` are **frozen** devices with `firestore-bridge.js` embedded
inside them. Editing `code/firestore-bridge.js` or the root .amxd files does
NOTHING to the distributables until they are refrozen.

After any change to the JS or a patch:

1. Deploy sources next to the unfrozen devices in the User Library:
   - `Scale Navigator Bridge.amxd`, `Ensemble Bridge.amxd` (repo root) and
     `code/firestore-bridge.js`
     → `/Users/soney/Music/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect/`
   - (loose node files there were archived to `archive/` — restore
     `firestore-bridge.js` next to the .amxd for the freeze step)
2. Nathan (GUI required), for EACH device: drag device onto a MIDI track →
   pencil icon (edit in Max) → click the **snowflake** (Freeze Device) in the
   patcher's bottom toolbar → Cmd+S → close editor
3. Copy the frozen results from the User Library back to `dist/` in this repo
4. Verify the freeze (Claude can do this headlessly):
   - Frozen file directory lists the patcher + `firestore-bridge.js` (embedded
     JS size must match `code/firestore-bridge.js`)
   - Patcher JSON inside the frozen file contains the newest object ids
   - Single-file test: copy to Desktop, drag into Live from Finder, banner
     goes green with no loose files in the search path

Notes:
- The chord DB IS now inlined into `firestore-bridge.js` as `const CHORD_DB`
  (trimmed to `{ v: voicing, r: root }` per id, ~58KB). Regenerate after DB
  changes with `python3 scripts/inline-chord-db.py` (reads
  `code/chords_no_supersets.json`, rewrites the CHORD_DB line in place).
  This matters because many clients (e.g. NotesChordScales) write `chordData`
  WITHOUT `chordInfo`; the bridge only trusts `chordInfo` when
  `chordInfo.id === chordData`, otherwise it falls back to CHORD_DB.
- `package.json` is not needed (zero npm deps; `max-api` is provided by Max).

## amxd file format (for scripted patch edits)

- Unfrozen: 20-byte header (`ampf` + `mmmm` + `ptch` + LE uint32 JSON size at
  offset 16) then patcher JSON. Rewrite the size field after editing.
- Frozen: `ampf` header → `meta` chunk → `ptch` chunk containing an `mx@c`
  container (patcher JSON + embedded files + a directory of
  `type/fnam/sz32/of32` records at the end).

## Testing

- Headless harness: mock `max-api` in `/tmp/bridge-harness/node_modules/max-api`
  (post/outlet → console.log, addHandler → `_handlers` map), `process.chdir`
  to `code/`, then `require` the bridge and call
  `maxApi._handlers['room']('la-laptop-orchestra')` (the JS no longer
  auto-connects). Run with `NODE_PATH=/tmp/bridge-harness/node_modules`.
- Deterministic tests: `/tmp/bridge-harness/test-paths.js` (monkeypatches
  `https.get`; 8 scenarios incl. idle-at-load and room-clear).
- Live room doc: `https://firestore.googleapis.com/v1/projects/scale-navigator-ensemble/databases/(default)/documents/rooms/la-laptop-orchestra`

## Open issues

See GitHub: #1 UI polish, #2 Chord Prime Form output mode, #3 Blaze upgrade
(quota: one instance at 0.5s polling burns the free tier in ~7h), #4 Starter
Live Set.
