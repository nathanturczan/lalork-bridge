# LALORK Bridge (M4L) — Project Notes

## Current canonical device

`LA Laptop Orchestra Bridge.amxd` (repo root) is the shipping LALORK device.
**Do not assume its freeze state from this doc — verify from the bytes**
(unfrozen: plain `ptch` + raw patcher JSON; frozen: `mx@c` container with an
embedded-file directory; see "amxd file format" below). As of Aug 12 2026
evening it is **FROZEN** (Nathan refroze after the downbeat-hold JS landed;
verified headlessly: embedded JS byte-identical to `code/firestore-bridge.js`
md5 `bb514fd2…`, patcher JSON intact — 69 boxes, `node.script`, `mode_tab`).
Single-file portable; Desktop drag-in test passed Aug 13 and the device
was sent to Elvis. Remember: while frozen, edits to `code/` do NOTHING
until refreeze.

**Re-verified Aug 14 2026:** still frozen (`mx@c` at offset 32), 212811
bytes, md5 `21d421e5…`, and the exact bytes of `code/firestore-bridge.js`
(md5 `bb514fd2…`) appear verbatim at offset 117417. The root mirror
`firestore-bridge.js` is byte-identical to `code/`.

- JS source of truth: `code/firestore-bridge.js`. The repo-root
  `firestore-bridge.js` is a mirror kept byte-identical (it's what an
  unfrozen device loads from the search path during edit/refreeze cycles —
  re-copy after any `code/` change).
- The device is the Stack White played instrument (NoteSource
  Chord/Root/Scale per instance) + tempo/Scale Awareness sync. Full behavior
  spec in `README.md`; design history in `DESIGN_JOURNEY.md`.

### Where it ships from

The public download lives in **`lalork-rehearse/pieces/`** (that repo's Vite
`publicDir`, so files there are served at the site root):
`rehearse.lalaptoporchestra.com/LA%20Laptop%20Orchestra%20Bridge.amxd`.
Enter's ABLETON page links it as **Bridge Only** via
`enter/src/constants/downloads.ts` (`DOWNLOAD_BASE` defaults to
`https://lalork-rehearse.vercel.app`). The Ableton template zip embeds its
own copy of the device.

**After every refreeze, update BOTH** the standalone file in
`lalork-rehearse/pieces/` and the copy inside the template zip, then
`vercel --prod` from `lalork-rehearse` (that project has **no git
auto-deploy** — pushing alone does not publish). On Aug 14 the standalone
was found to still be the Aug 4 freeze (md5 `a649e588`, no
`anticipationMs`) while the zip had the current device — the two downloads
were shipping different bridges for 9 days.

### Device UI / room protocol

- `mode_tab` (live.tab): 0 = Rehearsal, 1 = Performance. Globally synced
  across instances via `send/receive lalork-mode`; visibility switched with
  `thispatcher script show/hide`.
- Rehearsal: `rehearsal_input` (textedit) + JOIN button. A committed code
  goes `route text` → `send lalork-room`; every instance's
  `receive lalork-room` → `prepend room` → node.script. So joining is
  **always global** — the sender joins via its own receive too.
- Performance: JOIN button sends `la-laptop-orchestra` into the same
  `send lalork-room` path.
- Effective-room display (#27 fix): the JS outlets `roomcode <code>` once
  per (re)connection (deduped — NOT per poll; per-poll emission would stomp
  in-progress typing). In the patch, `route` outlet 10 (`roomcode`) feeds
  both `select la-laptop-orchestra` (PERFORMING/REHEARSING banner) and
  `prepend set` → `rehearsal_input`, so every instance's textbox shows the
  room its own node script is actually polling. Empty `roomcode` = genuine
  clear (`room ''` or `disconnect`) — deliberately NOT emitted during a
  room switch or failed join, so typed input survives a typo.
- Lobby: umenu + refresh → `refreshRooms` / `selectRoom <index>`; lobby
  picks display the friendly `roomName` (JS `config.displayName`), never
  the doc ID. The room field accepts doc IDs, slugs, or roomNames
  (case-insensitive; spaces OK — `room` handler joins args).
- The JS stays `idle` until it receives a `room` message; it emits
  `loaded 1` after init (last `route` selector) so the patch never sends a
  room before handlers are registered.
- **No persistence:** `pattr room_code @bindto room_field` is DANGLING
  (there is no `room_field`; the textedit is `rehearsal_input`) and lacks
  `@parameter_enable 1`. Room codes do NOT persist with a Live set; every
  load starts idle with an empty field. Deliberate for now — see issue #29
  before "fixing" this (auto-join on restore reopens #19 races and the #21
  stale-room-at-showtime hazard).

## Legacy devices

- `Ensemble Bridge.amxd` and `Scale Navigator Bridge.amxd` (repo root,
  unfrozen) use the OLD pre-Stack-White patch wiring (`playChords` etc.).
  Opened against the current script they log "no handler" warnings. Their
  frozen copies in `dist/` are self-contained and unaffected. Don't
  refreeze them against the new script without reworking their patches.
- **Never publish these.** A frozen `Ensemble Bridge.amxd` (117624 bytes,
  md5 `493b11d6…`, containing `playChords`) was sitting in
  `lalork-rehearse/pieces/` and was therefore reachable at
  `rehearse.lalaptoporchestra.com/Ensemble%20Bridge.amxd` — unlinked from
  both apps, but a live URL that could be shared or bookmarked. Removed
  Aug 14 2026; that path now 404s. It does not speak the current room
  protocol, so anyone who got it would have failed silently.
- `bundle/LA Laptop Orchestra/` holds the starter template (.als, Lessons,
  frozen device copy). The bundle's device copy is the Aug 4 freeze —
  **stale, pre-#27**. Template fixes are with Elvis (issues #24–26, #28);
  refresh the bundle device when the template is rebuilt.

## CRITICAL: Freeze workflow

Frozen devices embed `firestore-bridge.js`. Editing `code/` does NOTHING
to a frozen device until Nathan refreezes it (GUI only).

To change the canonical device:

1. Claude edits `code/firestore-bridge.js`, mirrors to root
   `firestore-bridge.js` (md5 must match), runs `node test/*.js`.
2. Patch edits: the root .amxd is frozen, so either (a) Nathan unfreezes in
   Max first (snowflake toggle → save) so Claude can edit the patcher JSON
   headlessly, or (b) Claude extracts the patcher JSON from the frozen
   container, rebuilds an unfrozen amxd (chunk layout below), edits, and
   Nathan freezes that.
3. Nathan (GUI): new empty Live set → drag device onto a MIDI track →
   pencil (edit in Max) → **snowflake** (Freeze Device) → save over the
   repo-root file.
4. Claude verifies headlessly:
   - Embedded JS is byte-identical to `code/firestore-bridge.js`
   - Patcher JSON inside the container has the intended changes (parse:
     find `"patcher"`, backtrack to `{`, `json.JSONDecoder().raw_decode`)
   - Container directory lists `firestore-bridge.js`
   - Nathan then does the single-file test: copy to Desktop, drag into
     Live from Finder, device works with no loose files in the search path
     (device starts idle/gray until a room is committed — that's correct)

Notes:
- The chord DB is inlined into `firestore-bridge.js` as `const CHORD_DB`
  (trimmed `{ v, r }` per id, ~58KB). Regenerate after DB changes with
  `python3 scripts/inline-chord-db.py` (reads
  `code/chords_no_supersets.json`, rewrites the CHORD_DB line in place).
  Needed because many clients (e.g. NotesChordScales) write `chordData`
  WITHOUT `chordInfo`; the bridge only trusts `chordInfo` when
  `chordInfo.id === chordData`, else falls back to CHORD_DB.
- `package.json` is not needed (zero npm deps; `max-api` comes from Max).

## amxd file format (for scripted edits)

Parse chunks — don't assume fixed offsets. Observed layouts:

- Unfrozen: `ampf` + u32 + `mmmm`, then a small `meta` chunk (4 bytes,
  `01 00 00 00`), then `ptch` + LE u32 size + patcher JSON (+ trailing
  NUL inside the counted size). Rewrite the ptch size field after editing;
  keep everything outside the JSON byte-identical.
- Frozen: same `ampf`/`mmmm`/`meta` prelude, then `ptch` chunk containing
  an `mx@c` container: patcher JSON + embedded files + a directory of
  `type/fnam/sz32/of32` records at the end. Do NOT byte-edit inside a
  frozen container (directory offsets would break) — go through the freeze
  workflow above.
- Textual JSON surgery (insert/replace with exact Max 4-1-space-indent
  formatting, then fix the size field) keeps diffs minimal and survives
  Max round-trips. Always re-parse and structurally diff against the git
  original afterward.

## Testing

Self-contained deterministic tests in `test/` (mock `max-api` + `https`
via `Module._load`, no network, no Max):

- `node test/stack-white-test.js` — 18 checks: palettes, held-note
  re-pitching, refcounting, flush/disconnect cleanup, downbeat hold (#32).
- `node test/roomcode-test.js` — 11 checks: #27 roomcode display protocol
  (emit-once, poll silence, error→recovery re-emit, no blank on room
  switch or typo'd join, clear/disconnect, lobby friendly names).

Run both after ANY JS change. Live room doc for manual checks:
`https://firestore.googleapis.com/v1/projects/scale-navigator-ensemble/databases/(default)/documents/rooms/la-laptop-orchestra`

## Open issues

Device: #1 UI polish, #2 Chord Prime Form output mode, #5 streaming
listener (replace polling), #19 global sync init rules, #20 join
lifecycle, #21 force-room during performance, #29 room-code persistence
(dangling pattr — read the issue before touching), **#33 the URLs printed
in the device are wrong** — the `rehearse_url` / `enter_url` comment boxes
read `rehearse.laptoporchestra.com` and `enter.laptoporchestra.com`,
missing the second `la`, and neither domain resolves. Deferred past Aug 15
because fixing it needs a refreeze; fold it into the next freeze cycle.
Infra: #3 Blaze upgrade (one instance at 0.5s polling burns the free tier
in ~7h), #17/#18 rehearsal-room lifecycle → `docs/rehearsal-room-lifecycle.md`.
Template (Elvis): #4 starter set, #24 arm-key collisions, #25 registers,
#26 preset differentiation, #28 device path linking.
