# Design Journey: From Drone to Gate to QWERTY Rows to Stack (White)

How the Bridge's note output design evolved between the Phil Meyer call (Aug 3, 2026)
and the current plan. Recorded because the path was long, several attractive designs
died on verified technical constraints, and none of us wants to relitigate them.

Related: issue #23, the Phil call archive
(`lalork/sessions/calls/2026-08-03-phil-meyer/` — SUMMARY.md, transcript,
`phil-gate-patch.png`), Tonalign source (`/Users/soney/Github/Tonalign`).

---

## Where it started: the drone

The shipped device (`LA Laptop Orchestra Bridge.amxd`, frozen) connects Ableton
to a Firebase ensemble room and follows the current BPM, scale, and chord. It
plays **sustained notes** the moment it connects: chord voicing, chord root, or
scale notes (selected per instance), held until the harmony changes, re-attacked
on every change. A Play checkbox toggles output on/off. The user does nothing;
the device drones.

The work immediately before this journey was making rehearsal setup painless:
paste one private rehearsal code into one Bridge and all instances join the same
room; Rehearsal/Performance mode and room selection synchronize globally across
instances; Performance mode auto-joins `la-laptop-orchestra`; each device keeps
its own output mode. That global-room / per-device-output split survives every
design below.

Problem, per the Aug 3 call: in an ensemble, a device that sounds without a
performer doing anything produces overplaying and no listening. Phil's framing
became the design's north star:

> **The airport luggage cart principle.** Default state is off; user action brings
> it on. Like a cart brake or a train interlock, the failsafe direction is silence.
> No input gesture, no sound.

## Design 1: Gate mode (Phil's borax patch)

Phil prototyped it on the call (screenshot in the call archive): `notein → borax`,
count active input notes, 0→1 transition fires note-ons for all chord tones (first
note's velocity passed through), 1→0 flushes everything. Incoming **pitch is
ignored** — the user contributes rhythm, the room contributes harmony. Upstream
sequencers become rhythm machines for the current chord.

Initially drafted as a second mode next to the drone. **Corrected**: gate is the
*only* mode. A drone mode is exactly what the airport cart forbids.

This became issue #23 ("Make Bridge output gate-only") with 12 acceptance tests,
plus a hardening pass: `Map<channel:pitch, count>` note tracking (not a plain Set —
same pitch on two channels), velocity-0 note-on treated as note-off, CC123 handling,
transport-stop flush, first note establishes gate velocity (no "latest wins"),
two-state banner (`WAITING FOR MIDI — PLAY A NOTE` / `GATE OPEN`). Rollout protocol:
branch first, current device stays the Aug 15 fallback — #23 is a musical
improvement, not permission to destabilize the show.

What the pure gate had going for it: very simple; the most literal embodiment of
the airport cart; works with controllers, clips, and sequencers; legato input
sustains while detached input rearticulates; wrong pitches are impossible because
pitch has no effect.

**Why it wasn't enough — two problems:**

1. **Onboarding.** A gate needs a MIDI gesture to open it, and the baseline LALORK
   Ableton user has no controller — just a laptop.
2. **No melodic agency.** Ignoring pitch turns a full keyboard into one large
   button. Chord and Root triggering make sense; Scale mode fires the entire
   scale as a cluster unless an arpeggiator follows it. The performer gets rhythm
   and velocity, but no say in *which* notes or *what register*. This doubt
   ("why ignore incoming pitch?") kept resurfacing under every later design.

## Interlude: three-track a/s/d and template routing

Between designs, an appealing framing: separate Chord, Root, and Scale tracks,
with `a`, `s`, `d` as three pushcart handles — hold combinations to layer chord,
bass, and arpeggio material. Explainable in one sentence.

First attempt to realize it: **template routing** — per-track stock Pitch MIDI
effects with single-note range filters so `a`, `s`, `d` reach different tracks,
keeping the Bridge itself simple. Why it became unsatisfying:

- Live's Computer MIDI Keyboard sends notes to armed/monitored tracks; there is
  no inherent "A to track 1, S to track 2."
- Single-note filters are brittle for hardware keyboards, where octave placement
  varies — one octave button press and the instrument goes silent.
- Keyboard zones suit hardware better but ruin the simple A/S/D story.
- It made the template responsible for too much hidden routing.

Also considered here: a **launchable MIDI clip** in the starter Set providing
rhythmic gate notes — support for users without a controller and a quick audible
test. Rejected as unnecessary to the primary interaction and increasingly
distracting from the actual device design.

## Design 2: The pushcart button

Replace the Play checkbox with a **momentary button** — pressed and held = output,
released = flush. Every Bridge instance gets its own visible "handle"; map it via
Cmd-M/Cmd-K; template auto-mapped to `a`/`s`/`d` for chord/root/scale tracks. The
most literal implementation of Phil's metaphor.

**Died on a verified Live constraint:** Cmd-K computer-key mappings fire on
**key-down only**. There is no key-release event, so a key-mapped button cannot be
*held* — generic computer-key mapping cannot be trusted as a sustained gate.
Cmd-M MIDI mappings do get note-on/off (though even that deserves a live test —
some reports say note mappings to buttons toggle rather than act momentary). And
a button-only design would exclude normal MIDI flowing through the track unless a
second input path was added. The "minimal" button solution kept accumulating
exceptions.

The patch attempt: a **combined gate** — open while *either* the on-screen button
is held *or* incoming MIDI notes are held. Mouse, controller, QWERTY MIDI, clips,
sequencers all covered. Technically sound, but it preserved the larger unanswered
question: why ignore incoming pitch at all?

## The Tonalign comparison

Tonalign already embodies the same philosophy: no gesture means silence; harmony
constrains the available notes; the performer controls when and how notes happen.
The critical difference from the pure gate: Tonalign's **Stack** modes use the
incoming note's *position* to select an allowed harmonic note — incoming notes
become ordered selectors rather than literal pitches. Keys walk upward through an
ordered palette, repeating it in higher octaves. For Cmaj7: 60, 64, 67, 71, 72,
76, 79, 83… This preserves the pushcart principle while restoring melodic and
registral agency — it resolved the doubt that had haunted the gate designs.

## Design 3: QWERTY row mapping (raw key capture)

Tonalign's Stack machinery gives the algorithm for free: octave wrapping
(`source[i % len]`, octave = `i / len`), note-offs tracked via an active-notes
map so releasing a key kills the pitch it actually started, held notes re-pitched
when harmony changes (Interrupt).

Proposal: capture a physical keyboard row directly inside Max, map its
left-to-right key positions across the harmonic palette. Two dropdowns per
device instance —

1. **NoteSource** (renamed from Output): Chord (voicing collapsed into one octave,
   rotated to the root, based at 60), Chord Root, Scale
2. **QWERTY row**: `1234` / `qwer` / `asdf` / `zxcv`

Cmaj7 on the qwer row: Q=60, W=64, E=67, R=71, T=72 (wrap), Y=76… Three device
instances on three tracks, three rows, three simultaneous layers, zero arming,
zero mapping. Musically this is still the target UX.

**Died on the input transport.** The plan assumed Max `[key]`/`[keyup]` objects
receive keystrokes whenever Live has focus. Deep research (Cycling '74 forums,
consistent across years) says no:

- `key`/`keyup` only receive events when the **device UI itself has click-focus**.
  Click anywhere else in Live — another track, the browser, a text field — and keys
  go silent.
- Worse: a key **released** after clicking away never delivers its key-up →
  **stuck note**. Disqualifying for a stage of first-time Ableton users.
- M4L cannot consume keystrokes; Live shortcuts on the same keys still fire and
  can collide with performance keys.
- The `hi` object workaround (global HID listener) is legacy, macOS-only, requires
  the Input Monitoring permission prompt on every machine, and listens even when
  Live isn't frontmost (typing in Chrome plays notes). Not shippable for a
  borrowed-laptop ensemble.
- The existing third-party **Extended Computer MIDI Keyboard** device proves the
  concept is possible — and explicitly documents these same limitations. It
  confirms the production problem rather than solving it.
- Other routes (Max 9 `hid`, external helper apps, MIDI Remote Scripts) might
  eventually support a full four-row instrument, but they introduce platform,
  permissions, focus, packaging, and reliability concerns inappropriate before
  August 15.

What this cements: do not capture raw QWERTY inside the Bridge; no Keyboard Row
selector; no reliance on `key`/`keyup`, Cmd-K, or a third-party full-keyboard
device. What survives: the NoteSource dropdown, all the index math, note-off
tracking, harmony re-pitch — everything except where the index comes from.

## Design 4 (shipped Aug 4): Stack (White) over incoming MIDI

Port Tonalign's **Stack (White)** algorithm (`Tonalign/Source/PluginProcessor.cpp`,
`getWhiteKeyStackedMidiNote`, lines ~399–465) into the bridge JS, applied to
**incoming MIDI notes** on the device's track:

- White-key index = `octave * 7 + position` (C=0, D=1, … B=6); black keys blocked
- Output = `source[index % len]` + octave wrap (`index / len`)
- NoteSource dropdown chooses the source array: Chord / Chord Root / Scale
- Note-off tracking Tonalign-style: store `(inputNote, channel) → outputNote` at
  note-on, release exactly that pitch at note-off, even if harmony changed mid-hold
- Harmony change while notes held: re-pitch (off old, on new), like Interrupt=on
- Flush on disconnect, room-clear, transport stop, device delete — all #23
  failsafes carry over
- Drone machinery removed. No note in, no sound out. Airport cart intact.

State model unchanged: room and Rehearsal/Performance mode stay global across
instances; NoteSource stays per-device.

Input stories, one code path:

- **QWERTY users**: Live's built-in **Computer MIDI Keyboard** (press M). Its
  A-row *is* white keys, so its playable keys become consecutive harmonic
  positions — the Design-3 experience on the home row, via the mechanism Ableton
  actually supports. Focus-proof, cross-platform, no permissions. With
  NoteSource = Chord and Cmaj7 current:

  | Key | A | S | D | F | G | H | J | K |
  |---|---|---|---|---|---|---|---|---|
  | Out | C4 | E4 | G4 | B4 | C5 | E5 | G5 | B5 |

- **Controller users**: white keys behave identically — the same MIDI input path,
  with real velocity, polyphony, and note identity. The earlier "does this solve
  for real MIDI too?" question answers itself.

Why Stack (White) specifically (vs chromatic Stack): the white keys *are* the
interface, and every input device already has them. A S D F G H J K L is white
keys C4–C5 on the CMK; on hardware it's the same white keys under the hand in the
default octave — no octave hunting, no zone setup. Black keys silently do nothing
(CMK: W E T Y U; hardware: the actual black keys) — no wrong note possible, and
dead keys are self-documenting. Wrapping degrades gracefully with harmony size:
a triad wraps every 3 white keys, a 7-note scale wraps at the octave almost like
a real keyboard, Root mode turns the row into octaves of the bass. "Right =
higher" always holds regardless of NoteSource.

Implementation note: Tonalign anchors white-key index 0 at MIDI 0; the Bridge
instead anchors input MIDI 60 (the CMK's A key) to the first palette note, so
the CMK default octave and a hardware keyboard's middle register both land in a
musical range. (The Cmaj7 table above shows the original C4-based plan; live
testing later moved every NoteSource into lower registers — see "Shipping day"
below.)
- **Layer selection**: the row dropdown dies (it only existed to serve raw key
  capture). Layers are chosen by **track arming** — see below.

## Layer selection: key-mapped arm toggles (tested, works)

The three-layer idea survives after all, via Live-native track arming. With three
tracks (CHORD / ROOT / SCALE, one Bridge each), any combination can be armed —
none, any one, any pair, or all three. The Computer MIDI Keyboard (and any
hardware controller) sends the same performance to **every armed track**, and
each Bridge interprets it through its own NoteSource. Pressing A with all three
armed sounds first chord tone + root + first scale degree at once.

Arm toggles are key-mappable via Cmd-K: map `1` → CHORD arm, `2` → ROOT arm,
`3` → SCALE arm. The instrument becomes:

> **1 / 2 / 3 choose your layers. A–L plays them.**

Why Cmd-K is fine here when it killed the pushcart button: **arming is a toggle**,
and Live key mappings are key-down-only toggles. The failure was asking a key
mapping to be *momentary*; asking it to toggle is exactly what it does.

Requirements and reinforcements:

- **Exclusive Arm must be off** (Preferences → Record/Warp/Launch, or right-click
  an Arm button → uncheck Arm Exclusive) so multiple tracks stay armed;
  Cmd-clicking Arm buttons temporarily reverses exclusive behavior.
- The performer must always know which layers are live. Live already shows this —
  armed = red Record-Arm circle — reinforced by clear track names (CHORD, ROOT,
  SCALE), consistent track colors, Arm buttons visible without scrolling, and the
  Set shipping with one sensible track armed (Chord).
- Arming can change freely mid-performance; the mapping persists with the Set.
- Concern that number keys collide with Live's built-in 1–7 shortcuts (browser
  collections etc.): **empirically tested Aug 4 with CMK enabled — 1/2/3 toggle
  arms correctly, combinations hold, A–L still plays, no unwanted Live actions.**

**The tradeoff, stated plainly:** we give up the seductive idea of four raw QWERTY
rows played independently with zero clicks. In exchange: one dependable instrument
that works identically for QWERTY MIDI and hardware MIDI — reliable note-on,
note-off, velocity, polyphony, no stuck notes, no focus fragility, Windows works,
and the core algorithm is a direct port of shipped, tested Tonalign code. With
key-mapped arm toggles, the multi-layer play the QWERTY rows promised comes back
anyway — 1/2/3 for layers instead of four rows. That is the right deadline
decision: preserve the musical concept, remove the fragile input technology.

## Shipping day (Aug 4): implementation and the live-testing pass

Design 4 was implemented in `firestore-bridge.js` on branch
`feature/stack-white-notesource`, verified by 16 deterministic offline checks
(`node test/stack-white-test.js` — a mock `max-api`/`https` harness that replays
Firestore docs and MIDI events), then refined in one long morning of live
play-testing in Live with the room running. Merged to `main` as `8409ad5`.
What changed between the plan above and the shipped engine:

**Root was silent, then became a bass instrument.** Chord Root's palette is one
note, and the naive Stack wrap (octave per white key) pushed most of the CMK row
outside MIDI 0–127 — blocked, so Root produced nothing at all. First fix: a
whole row plays the same note, each row up/down shifts an octave. Then Root was
redesigned entirely into **bass zones** via a 6-element palette `[r, r, r, f, f,
f]`: **A S D** play the chord root, **F G H** play its "fifth", **J K L** the
root an octave up, and the standard wrap continues the pattern in both
directions with no special casing.

**The fifth-selection rule**, hardened through examples: convert chord tones to
intervals above the root mod 12, drop 0, pick the interval closest to 7;
equidistant tie → the **higher** interval (root+8 over the root+6 tritone);
root-only chord → the root itself. One example in the spec ([0,4,10] → 4)
contradicted the stated tie rule; resolved explicitly as "always higher"
([0,4,10] → 10), and locked in a test.

**Everything dropped registers, by ear.** The plan's C4 anchoring was too high
in the room. Live listening moved Chord's close-position palette to start near
**MIDI 36** (Cmaj7 → [36, 40, 43, 47]) and Root's zones near **MIDI 24**. Each
drop came from playing and saying "still an octave too high," not from theory.

**Scale became a fixed C-anchored window.** Instead of stacking scale tones
from the scale root, Scale places each pitch class at 48 + pc — a fixed MIDI
48–59 window sorted ascending, anchored at C regardless of scale root. The
payoff is **parsimony across scale changes**: shared tones stay on the same
physical keys, so c_diatonic → g_diatonic moves exactly one key. An alternative
"C, else C#, else B" anchor chain was analyzed: identical for 54 of 57 scales,
and on the 3 scales containing neither C nor C# the two schemes just fail
differently — the stateless window won on simplicity. **Chord stayed
root-anchored** after considering the same window treatment: chords gain little
key-stability from it and would lose root-on-first-key, which Root and Chord
both depend on musically.

**Documentation convention:** all pitch references switched to raw MIDI note
numbers, because Live displays MIDI 60 as C3 (octave-naming conventions differ
across vendors) and "C2" means different pitches to different readers.

**Known input characteristic:** Live's Computer MIDI Keyboard is not
velocity-sensitive — it sends a fixed velocity, stepped down/up with C/V. The
Bridge preserves incoming velocity as-is, so hardware controllers get full
dynamics and CMK players get the fixed value. No device-side velocity synthesis
was added.

Everything else survived intact from the plan: black keys blocked (offs
dropped too), note-off tracking releases the exact generated pitch across
harmony changes, held notes re-pitch on harmony or NoteSource change (offs
first, velocities kept), duplicate outputs refcounted, CC123 flushes, non-note
MIDI passes through, tempo/scale sync idempotent across instances.

Remaining to ship: the frozen device, template `.als`, and bundle ZIP still
predate this redesign — the freeze → template rebuild → re-zip → standalone
test sequence is written up as `NATHAN_GUI_PROCEDURE.md`. Until it runs, the
old frozen device in `bundle/` remains the working Aug 15 fallback.

## The multiplier: one Bridge makes the whole Set scale-aware

The quiet payoff of the whole design, easy to miss while staring at the played
layers: the Bridge doesn't just remap its own track's notes — it sets **Live's
global Scale** (root + scale name) directly through the LOM, and tempo with it.
That state is Set-wide. Every **scale-aware** device in Live 12 — Arpeggiator,
the MIDI Transformation/Generator tools, Push layouts, Wavetable, scale-aware
third-party plugins, clips with Scale on — follows it automatically.

So the instrument scales in two independent directions:

- **Played layers** (Chord / Root / Scale NoteSources) need one Bridge per
  track, because the remapping happens in the device's own MIDI path.
- **Harmony sync** needs exactly **one** Bridge in the Set, anywhere. Add as
  many MIDI tracks as you like, turn Scale on, load any scale-aware devices,
  and everything sequenced or played on them stays in the ensemble's harmony —
  zero extra wiring, zero extra Firestore reads.

This is why sync was built idempotent across instances (any Bridge sets the
same values; multiple instances coexist): the three-track template works out of
the box, and a player who deletes two Bridges to build their own scale-aware
rig loses nothing. The Bridge is both an instrument and the Set's harmonic
clock; the entire Live 12 scale-aware ecosystem becomes the ensemble's
instrument palette for free.

## Decision log

| Decision | Status |
|---|---|
| Drone as default output | **Rejected** — violates airport cart |
| Gate as an added mode beside drone | **Rejected** — gate-only or nothing |
| "Latest velocity wins" while gate held | **Rejected** — first note sets velocity |
| Plain `Set<pitch>` note tracking | **Rejected** — `Map<channel:pitch, count>` |
| PANIC button / sustain-pedal handling | **Deferred** |
| Launchable MIDI clip in starter Set | **Rejected** — scaffolding, need vanished |
| Pure gate (pitch fully ignored) | **Superseded** — no melodic agency; keyboard = one big button |
| Three-track a/s/d via template Pitch-filter routing | **Rejected** — brittle single-note filters, hidden routing, no per-key track routing in Live |
| Pushcart momentary button via Cmd-K | **Rejected** — key mappings are key-down only |
| Combined gate (button OR held notes) | **Superseded** — sound, but kept pitch ignored |
| Raw `[key]`/`[keyup]` QWERTY rows + Keyboard Row selector | **Rejected** — focus-dependent, stuck notes |
| `hi` / `hid` / external helpers / Remote Scripts for key capture | **Rejected pre-Aug 15** — platform, permissions, packaging risk |
| Tonalign-style pitch **correction** modes | **Deferred** — Stack (White) only for now |
| Octave-transpose option | **Deferred** |
| Stack (White) on incoming MIDI + NoteSource dropdown | **Shipped Aug 4** — merged to `main` (`8409ad5`), 16 offline checks green |
| Key-mapped 1/2/3 arm toggles for layer selection (Exclusive Arm off) | **Adopted** — tested Aug 4, works with CMK + A–L |
| Root as bass zones: A S D root (near MIDI 24) / F G H fifth / J K L root+12 | **Adopted** — via `[r,r,r,f,f,f]` palette, standard wrap |
| Fifth rule: chord-tone interval closest to 7, tie → higher, root-only → root | **Adopted** — tritone avoided on ties; [0,4,10] → 10 locked in test |
| Scale as fixed C-anchored MIDI 48–59 window (parsimonious scale changes) | **Adopted** — over C→C#→B anchor chain (identical for 54/57 scales; window is stateless) |
| Chord window-anchored like Scale | **Rejected** — stays root-anchored close position near MIDI 36 |
| Docs use raw MIDI note numbers | **Adopted** — Live shows MIDI 60 as C3; octave names are vendor-relative |
| One Bridge syncs global Scale Awareness for the whole Set (scale-aware devices follow free) | **Adopted** — sync is idempotent; played layers still one Bridge per track |
| Device-side velocity synthesis for CMK (fixed-velocity input) | **Rejected** — velocity passed through; C/V steps + hardware controllers suffice |
| Branch-first rollout; frozen device is Aug 15 fallback | **Standing** — code merged; old frozen bundle stays fallback until artifacts rebuilt |

## Open items

- **Rebuild the artifacts** (the only thing between the merged code and the
  stage): freeze the device, rebuild the template `.als` (NoteSources, track
  names/colors, 1/2/3 arm mappings, Chord armed), re-zip, standalone test —
  step-by-step in `NATHAN_GUI_PROCEDURE.md`; full check is TESTING.md Phase 5
- Empirically verify `key`/`keyup` focus behavior on Live 12 if anyone is tempted
  to revisit Design 3 (a minimal test .amxd can be generated headlessly — see
  CLAUDE.md for the unfrozen amxd format)
- Test whether Cmd-M note mappings to a `live.button` are truly momentary in
  Live 12 (matters only if the pushcart button returns as a mouse affordance)

Closed:

- ~~Amend or supersede #23~~ — superseded by the shipped Stack (White) design;
  its failsafes (note tracking, CC123, flush paths) carried over into the engine
  and its tests
- ~~Template/Lesson text updates~~ — `LessonsEN.txt` rewritten (1/2/3 layers,
  M + A–L row, per-page Chord/Root/Scale descriptions); the Set rebuild itself
  is part of the artifact step above
- ~~Frozen device with no unfrozen source~~ — the repo-root unfrozen
  `LA Laptop Orchestra Bridge.amxd` + `firestore-bridge.js` mirror are now the
  canonical source; refreeze workflow lives in `NATHAN_GUI_PROCEDURE.md`
