#!/usr/bin/env python3
"""
Build "Booth Bridge.amxd" — the Music China booth device: the shipping
LA Laptop Orchestra Bridge with every Firestore-room control removed.

Same brain, smaller face. The device reuses firestore-bridge.js UNCHANGED
(the script's local harmony source — POST 127.0.0.1:8767/harmony — runs
regardless of rooms; with no room code the Firestore side just stays idle),
so all tested behavior (Live API appliers, note remapping, leader/follower
localpatch broadcast between instances) carries over byte-for-byte.

What the face shows, and nothing else:
    ● RECEIVING FROM PDF2PDF        (big banner: local / waiting / error)
    current chord (large), scale, BPM
    NoteSource: Chord / Root / Scale

Boxes and wiring are lifted verbatim from the shipping device (extracted
from its patcher JSON); only the room/lobby/mode-tab UI and its plumbing
are gone, and the status select now keys on 'local idle error disconnected'.

The .amxd wrapper is cloned from the shipping device: same chunk layout,
sizes fixed up for the new patcher JSON, trailing device snapshot dropped.

Run:  python3 scripts/build-booth-bridge.py
Then: open in Live once, confirm banner + play test, freeze via Max
      (snowflake) if distributing outside this repo.
"""
import json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "LA Laptop Orchestra Bridge.amxd")
OUT = os.path.join(ROOT, "Booth Bridge.amxd")

# ---------------------------------------------------------------- source
data = open(SRC, "rb").read()
i = data.find(b"ptch")
chunk_size = struct.unpack("<I", data[i + 4 : i + 8])[0]
header = data[: i + 8]                      # ampf/meta headers + 'ptch' + size
payload = data[i + 8 : i + 8 + chunk_size]
sub = payload[:16]                          # 'mx@c' + 3 big-endian uint32s
j0 = payload.find(b"{")
src_patch, src_json_len = json.JSONDecoder().raw_decode(
    payload[j0:].decode("utf-8", "replace"))  # trailing snapshot JPEG is not UTF-8
P = src_patch["patcher"]
boxes = {b["box"]["id"]: b["box"] for b in P["boxes"]}

KEEP = [
    "obj-node", "obj-route-main",
    "obj-send-localpatch", "obj-receive-localpatch", "obj-prepend-localpatch",
    "obj-bpm-display", "obj-set-tempo",
    "obj-root-display", "obj-scale-display", "obj-chord-display",
    "obj-loadbang", "obj-live-path", "obj-live-object",
    "obj-set-root", "obj-set-scale",
    "obj-prepend-root-disp", "obj-prepend-scale-disp", "obj-prepend-chord-disp",
    "obj-midiin", "obj-midiparse", "obj-unpack-note", "obj-pack-note",
    "obj-prepend-notein", "obj-prepend-ccin", "obj-midiformat", "obj-midiout",
    "obj-script-start", "obj-mode-menu", "obj-prepend-mode",
]
new_boxes = [{"box": json.loads(json.dumps(boxes[k]))} for k in KEEP]
BX = {b["box"]["id"]: b["box"] for b in new_boxes}

# ----------------------------------------------------- presentation face
def face(id_, x, y, w, h, **extra):
    bb = BX[id_]
    bb["presentation"] = 1
    bb["presentation_rect"] = [float(x), float(y), float(w), float(h)]
    bb.update(extra)

# wipe inherited presentation flags; only what face() touches is visible
for bb in BX.values():
    bb.pop("presentation", None)
    bb.pop("presentation_rect", None)

def add(bb):
    new_boxes.append({"box": bb})

# Status banner (driven by the status selector below)
add({
    "id": "booth-banner", "maxclass": "comment", "numinlets": 1, "numoutlets": 0,
    "bgcolor": [0.3, 0.3, 0.3, 1.0], "textcolor": [1.0, 1.0, 1.0, 1.0],
    "fontface": 1, "fontsize": 13.0, "textjustification": 1,
    "patching_rect": [700.0, 240.0, 300.0, 24.0],
    "presentation": 1, "presentation_rect": [5.0, 4.0, 410.0, 24.0],
    "text": "WAITING FOR PDF2PDF — PRESS START IN THE PLAYER",
})
# Labels
for lid, txt, rect in [
    ("booth-lbl-chord", "CHORD", [5.0, 34.0, 60.0, 18.0]),
    ("booth-lbl-scale", "SCALE", [5.0, 112.0, 60.0, 18.0]),
    ("booth-lbl-bpm",   "BPM",   [250.0, 112.0, 40.0, 18.0]),
    ("booth-lbl-src",   "PLAYS", [330.0, 112.0, 50.0, 18.0]),
]:
    add({
        "id": lid, "maxclass": "comment", "numinlets": 1, "numoutlets": 0,
        "fontsize": 10.0, "textcolor": [0.6, 0.6, 0.6, 1.0],
        "patching_rect": [1050.0, 240.0 + 30 * len(lid), 80.0, 18.0],
        "presentation": 1, "presentation_rect": rect, "text": txt,
    })

face("obj-chord-display", 5, 52, 410, 54, fontsize=32.0, fontface=1)
face("obj-scale-display", 5, 130, 235, 22, fontsize=13.0)
face("obj-bpm-display", 250, 130, 60, 22, fontsize=13.0)
face("obj-mode-menu", 330, 130, 85, 22)

# ------------------------------------------------ booth status messages
# The script emits status 'local' when PDF2PDF harmony arrives, 'idle' on
# load, 'error'/'disconnected' from the (unused) Firestore path.
add({
    "id": "booth-status-sel", "maxclass": "newobj", "numinlets": 5, "numoutlets": 5,
    "outlettype": ["bang", "bang", "bang", "bang", ""],
    "patching_rect": [700.0, 160.0, 280.0, 22.0],
    "text": "select local idle error disconnected",
})
for mid, rect_y, text in [
    ("booth-msg-local", 190.0,
     "set ● RECEIVING FROM PDF2PDF, bgcolor 0.13 0.55 0.27 1., textcolor 1. 1. 1. 1."),
    ("booth-msg-idle", 212.0,
     "set WAITING FOR PDF2PDF — PRESS START IN THE PLAYER, bgcolor 0.3 0.3 0.3 1., textcolor 1. 1. 1. 1."),
    ("booth-msg-error", 234.0,
     "set ✗ BRIDGE ERROR — REOPEN THIS LIVE SET, bgcolor 0.78 0.13 0.13 1., textcolor 1. 1. 1. 1."),
]:
    add({
        "id": mid, "maxclass": "message", "numinlets": 2, "numoutlets": 1,
        "outlettype": [""],
        "patching_rect": [1000.0, rect_y, 420.0, 22.0], "text": text,
    })

LINES = [
    # script lifecycle + Live API (verbatim from the shipping device)
    ("obj-loadbang", 0, "obj-live-path", 0),
    ("obj-loadbang", 0, "obj-script-start", 0),
    ("obj-script-start", 0, "obj-node", 0),
    ("obj-live-path", 1, "obj-live-object", 1),
    ("obj-node", 0, "obj-route-main", 0),
    ("obj-route-main", 0, "obj-bpm-display", 0),
    ("obj-bpm-display", 0, "obj-set-tempo", 0),
    ("obj-set-tempo", 0, "obj-live-object", 0),
    ("obj-route-main", 1, "obj-set-root", 0),
    ("obj-set-root", 0, "obj-live-object", 0),
    ("obj-route-main", 3, "obj-set-scale", 0),
    ("obj-set-scale", 0, "obj-live-object", 0),
    # displays
    ("obj-route-main", 2, "obj-prepend-root-disp", 0),
    ("obj-prepend-root-disp", 0, "obj-root-display", 0),
    ("obj-route-main", 4, "obj-prepend-scale-disp", 0),
    ("obj-prepend-scale-disp", 0, "obj-scale-display", 0),
    ("obj-route-main", 5, "obj-prepend-chord-disp", 0),
    ("obj-prepend-chord-disp", 0, "obj-chord-display", 0),
    # booth status banner
    ("obj-route-main", 6, "booth-status-sel", 0),
    ("booth-status-sel", 0, "booth-msg-local", 0),
    ("booth-status-sel", 1, "booth-msg-idle", 0),
    ("booth-status-sel", 2, "booth-msg-error", 0),
    ("booth-status-sel", 3, "booth-msg-error", 0),
    ("booth-msg-local", 0, "booth-banner", 0),
    ("booth-msg-idle", 0, "booth-banner", 0),
    ("booth-msg-error", 0, "booth-banner", 0),
    # note remap chain
    ("obj-route-main", 7, "obj-midiformat", 0),
    ("obj-midiin", 0, "obj-midiparse", 0),
    ("obj-midiparse", 0, "obj-unpack-note", 0),
    ("obj-unpack-note", 0, "obj-pack-note", 0),
    ("obj-unpack-note", 1, "obj-pack-note", 1),
    ("obj-midiparse", 6, "obj-pack-note", 2),
    ("obj-pack-note", 0, "obj-prepend-notein", 0),
    ("obj-prepend-notein", 0, "obj-node", 0),
    ("obj-midiparse", 2, "obj-prepend-ccin", 0),
    ("obj-prepend-ccin", 0, "obj-node", 0),
    ("obj-midiparse", 1, "obj-midiformat", 1),
    ("obj-midiparse", 2, "obj-midiformat", 2),
    ("obj-midiparse", 3, "obj-midiformat", 3),
    ("obj-midiparse", 4, "obj-midiformat", 4),
    ("obj-midiparse", 5, "obj-midiformat", 5),
    ("obj-midiformat", 0, "obj-midiout", 0),
    # NoteSource
    ("obj-mode-menu", 0, "obj-prepend-mode", 0),
    ("obj-prepend-mode", 0, "obj-node", 0),
    # leader/follower localpatch broadcast (multi-instance :8767 takeover)
    ("obj-route-main", 11, "obj-send-localpatch", 0),
    ("obj-receive-localpatch", 0, "obj-prepend-localpatch", 0),
    ("obj-prepend-localpatch", 0, "obj-node", 0),
]
new_lines = [
    {"patchline": {"destination": [d, di], "source": [s, si]}}
    for (s, si, d, di) in LINES
]

# ---------------------------------------------------------------- output
patcher = {k: v for k, v in P.items() if k not in ("boxes", "lines")}
patcher["description"] = ("Music China booth bridge: follows PDF2PDF harmony on "
                          "127.0.0.1:8767, sets Live tempo + Scale Awareness, remaps "
                          "played notes into the current harmony.")
patcher["boxes"] = new_boxes
patcher["lines"] = new_lines
out_json = json.dumps({"patcher": patcher}, indent=4).encode("utf-8")

# Rebuild the wrapper with sizes fixed up (JSON + NUL, snapshot dropped).
new_payload_body = out_json + b"\x00"
new_chunk_size = 16 + len(new_payload_body)
# mx@c header: magic, BE 16, BE 0, BE size field offset by the same constant
# the shipping device uses (field = chunk_size - 340 there).
delta = chunk_size - struct.unpack(">I", sub[12:16])[0]
new_field = max(0, new_chunk_size - delta)
new_sub = sub[:8] + struct.pack(">I", 0) + struct.pack(">I", new_field)
out = (
    header[: i + 4]
    + struct.pack("<I", new_chunk_size)
    + b"mx@c" + struct.pack(">I", 16) + new_sub[8:]
    + new_payload_body
)
open(OUT, "wb").write(out)
print(f"wrote {OUT}: {len(new_boxes)} boxes, {len(new_lines)} lines, "
      f"{len(out)} bytes (source {len(data)})")
