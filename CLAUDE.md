# Scale Navigator Bridge (M4L) — Project Notes

## CRITICAL: Refreeze workflow (the distributable is FROZEN)

`dist/Scale Navigator Bridge.amxd` is a **frozen** device with `firestore-bridge.js`
embedded inside it. Editing `code/firestore-bridge.js` or the root .amxd does
NOTHING to the distributable until it is refrozen.

After any change to the JS or the patch:

1. Deploy sources next to the unfrozen device in the User Library:
   - `Scale Navigator Bridge.amxd` (repo root) and `code/firestore-bridge.js`
     → `/Users/soney/Music/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect/`
   - (loose node files there were archived to `archive/` — restore
     `firestore-bridge.js` next to the .amxd for the freeze step)
2. Nathan (GUI required): drag device onto a MIDI track → pencil icon (edit in
   Max) → click the **snowflake** (Freeze Device) in the patcher's bottom
   toolbar → Cmd+S → close editor
3. Copy the frozen result from the User Library back to `dist/` in this repo
4. Verify the freeze (Claude can do this headlessly):
   - Frozen file directory lists the patcher + `firestore-bridge.js` (embedded
     JS size must match `code/firestore-bridge.js`)
   - Patcher JSON inside the frozen file contains the newest object ids
   - Single-file test: copy to Desktop, drag into Live from Finder, banner
     goes green with no loose files in the search path

Notes:
- Freezing does NOT embed `chords_no_supersets.json` (Node for Max only embeds
  the object-box script). That's fine: current rooms provide
  `chordInfo.voicing`/`root` (Harmony Payload v2); the DB is only a fallback
  for ancient Dashboard-hosted rooms. If ever needed, inline the DB into the
  JS and refreeze.
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
  to `code/`, then `require` the bridge. It auto-connects to the live
  `la-laptop-orchestra` room.
- Live room doc: `https://firestore.googleapis.com/v1/projects/scale-navigator-ensemble/databases/(default)/documents/rooms/la-laptop-orchestra`

## Open issues

See GitHub: #1 UI polish, #2 Chord Prime Form output mode, #3 Blaze upgrade
(quota: one instance at 0.5s polling burns the free tier in ~7h), #4 Starter
Live Set.
