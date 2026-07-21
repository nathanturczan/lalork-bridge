#!/usr/bin/env python3
"""Inline a trimmed chord DB into firestore-bridge.js.

Reads code/chords_no_supersets.json, trims each entry to
{ v: original_voicing, r: root }, and rewrites the
`const CHORD_DB = ...;` line (or the __INLINE_CHORD_DB__ placeholder)
in code/firestore-bridge.js. Idempotent: safe to re-run after DB updates.
"""

import json
import re
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
db_path = repo / "code" / "chords_no_supersets.json"
js_path = repo / "code" / "firestore-bridge.js"

db = json.loads(db_path.read_text())
trimmed = {
    chord_id: {"v": entry["original_voicing"], "r": entry["root"]}
    for chord_id, entry in db.items()
    if entry.get("original_voicing")
}
inline = json.dumps(trimmed, separators=(",", ":"))

js = js_path.read_text()
new_line = f"const CHORD_DB = {inline};"
js2, n = re.subn(r"const CHORD_DB = (__INLINE_CHORD_DB__|\{.*?\});", lambda m: new_line, js, count=1)
if n != 1:
    raise SystemExit("CHORD_DB line/placeholder not found in firestore-bridge.js")
js_path.write_text(js2)
print(f"Inlined {len(trimmed)} chord entries ({len(inline)} bytes) into {js_path.name}")
