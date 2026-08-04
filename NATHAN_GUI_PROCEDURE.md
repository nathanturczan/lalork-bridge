# Nathan's GUI Procedure: Ship the Stack White Bridge

Everything code-side is done and tested on branch `feature/stack-white-notesource`
(`node test/stack-white-test.js` → 14 checks pass). What remains needs the Max and
Live GUIs. Do these parts in order, in one sitting.

**Fallback:** the previous working device/bundle is untouched on `main`. If anything
here fails, ship `main` for August 15.

---

## Part A — Verify and freeze the device (Max)

The repo-root `LA Laptop Orchestra Bridge.amxd` is the unfrozen source. Its
`node.script firestore-bridge.js` loads the script sitting next to it at the repo
root (already synced from the canonical `code/firestore-bridge.js`).

1. In Live, make a **new empty set**. Drag the repo-root
   `LA Laptop Orchestra Bridge.amxd` onto a MIDI track, then put any instrument
   (e.g., a piano) after it on the same track.
2. Verify the device UI:
   - Banner goes green: `● FOLLOWING LALORK`
   - Dropdown reads **NoteSource:** with options **Chord / Root / Scale**
   - There is **no Play toggle**
3. Quick play test: arm the track, press **M** (Computer MIDI Keyboard), play the
   A–L row.
   - White keys sound notes in the current harmony; black keys (W, E, T, Y, U) do nothing
   - Hold a note while the room's chord changes → the held note re-pitches, no stuck notes
   - Switch NoteSource while holding → same: re-pitches cleanly
   - If anything fails here, STOP — report back, don't freeze
4. Click the **pencil** to open the device in Max. Confirm no red (missing) objects
   and the Max console shows the bridge loading.
5. **Freeze** (snowflake icon) — this embeds `firestore-bridge.js` into the device.
6. **File → Save As…** → overwrite
   `bundle/LA Laptop Orchestra/LA Laptop Orchestra Bridge.amxd`
7. Click the snowflake again to **unfreeze**, then **File → Save As…** → overwrite
   the repo-root `LA Laptop Orchestra Bridge.amxd` (keeps the source unfrozen).
   Close Max.

## Part B — Rebuild the template set (Live)

1. Open `bundle/LA Laptop Orchestra/LA Laptop Orchestra.als`.
2. On each of the three tracks, **delete the old Bridge device** and drag in the
   **newly frozen** `LA Laptop Orchestra Bridge.amxd` from the bundle folder,
   placing it **before** the instrument.
3. Set each device's **NoteSource**:
   - Track 1 (marimba) → **Chord**
   - Track 2 (bass) → **Root**
   - Track 3 (lead) → **Scale**
4. Rename the tracks (Cmd+R): **`1 Chord`**, **`2 Root`**, **`3 Scale`**.
   Give them three clearly different colors (right-click → color).
5. Preferences → **Record, Warp & Launch** → turn **Exclusive Arm OFF**.
   (This is a Live preference — it can't be saved in the set, which is why the
   Lesson also tells players to do it.)
6. Key mappings — **Cmd+K** (Edit Key Map), then:
   - Click track 1's **Arm** button, press **1**
   - Click track 2's **Arm** button, press **2**
   - Click track 3's **Arm** button, press **3**
   - **Cmd+K** again to exit key-map mode
7. **Arm track 1 (Chord) only**; the other two disarmed.
8. Check the **Lessons** pane shows the updated text (Playing section: "Press 1, 2,
   and 3…"). The text lives in
   `bundle/LA Laptop Orchestra/LA Laptop Orchestra Lessons/LessonsEN.txt` (already updated).
9. **Save the set** (Cmd+S).

## Part B2 — Capture the Lesson screenshots

The Lesson text already references these images. In place (Aug 4): the three
generated key diagrams (ChordKeys / RootKeys / ScaleKeys) and six captured
screenshots (RehearseJoin, BridgeFollowing, ComputerMIDIKeyboard,
ScaleAwareDevices, GlobalScale, ExclusiveArm). **One screenshot remains** —
without it the Lessons pane shows a stray filename. Save it as PNG **next to
`LessonsEN.txt`** in
`bundle/LA Laptop Orchestra/LA Laptop Orchestra Lessons/`:

| File | What to capture (tight crop, ~500–650 px wide) |
|---|---|
| `ArmKeys.png` | The track headers with **Arm buttons visible and red** — Chord / Root / Scale armed, colors visible (Session view crop that includes the arm row) |

Tips: Cmd+Shift+4 for a region screenshot; retina Macs capture at 2x — either
resize to ~600 px wide with Preview, or put the full-res copy in the `Large/`
subfolder under the same filename and the resized one next to the txt (that's
Ableton's own convention: `Large/` holds the 2x versions).

Then reopen the Lessons pane (View → Lessons) and confirm every page shows its
images — no literal `*.png` text anywhere. Close Live.

## Part C — Re-zip and standalone test

1. Rebuild the ZIP:
   ```bash
   cd "/Users/soney/Github/tempo-m4l-firebase-bridge/bundle"
   rm "LA Laptop Orchestra.zip"
   zip -r "LA Laptop Orchestra.zip" "LA Laptop Orchestra" -x '*.DS_Store'
   ```
2. **Standalone test** (simulates a player's laptop): copy the ZIP to the Desktop,
   extract it, open the extracted `.als`:
   - Lessons appear, banner green on all three devices
   - **1 / 2 / 3** toggle the arms; red arm = layer on
   - **M** + A-row plays each armed layer; Chord/Root/Scale behave per their names
   - All three layers armed at once → all three play together, no errors
3. Run **TESTING.md Phase 5** as the full check.
4. Only after all of the above passes: commit the frozen device + `.als` + ZIP on
   the branch, merge to `main`, and ship to R Tyler / Rehearse.

---

## Caveats

- `firestore-bridge.js` at the repo root is a **mirror** of the canonical
  `code/firestore-bridge.js` — keep them in sync (the root copy is what the
  unfrozen device loads and what freezing embeds).
- The root `Ensemble Bridge.amxd` and `Scale Navigator Bridge.amxd` dev devices
  still use the old patch wiring (`playChords` etc.). Opened against the new
  script they'll log "no handler" warnings. Their frozen copies in `dist/` are
  unaffected. Don't re-freeze those two against the new script without updating
  their patches first.
