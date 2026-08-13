#!/usr/bin/env node
// cleanup-rehearsal-rooms.js — one-time sweep of abandoned rehearsal rooms
// (lalork-bridge #17).
//
// DRY-RUN BY DEFAULT. Lists candidate rooms and exits without touching
// anything. Deletion requires BOTH --delete AND --yes, plus gcloud auth.
//
//   node scripts/cleanup-rehearsal-rooms.js                  # dry run, 30 days
//   node scripts/cleanup-rehearsal-rooms.js --older-than-days 60
//   node scripts/cleanup-rehearsal-rooms.js --delete --yes   # REALLY deletes
//
// What counts as a candidate (ALL must hold):
//   - doc ID starts with "rehearse-"           (created by the Rehearse app)
//   - looks like a rehearsal room              (roomName "Private Rehearsal"
//                                               or roomType "rehearsal")
//   - Firestore server updateTime older than the threshold (default 30 days)
//   - not in the PROTECTED list
//
// Anything else — named public ensembles, recently active rooms, docs with
// unexpected shapes — is skipped and reported, never deleted.
//
// Reads use the public REST API (rooms are world-readable). Deletes use an
// OAuth token from `gcloud auth print-access-token` (IAM bypasses Firestore
// rules, which only allow host/admin deletes).

"use strict";

const { execFileSync } = require("child_process");
const https = require("https");

const PROJECT = "scale-navigator-ensemble";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// Never deleted, no matter what the heuristics say.
const PROTECTED = new Set(["la-laptop-orchestra"]);

const DEFAULT_OLDER_THAN_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------- args ----------

const argv = process.argv.slice(2);
const wantDelete = argv.includes("--delete");
const confirmed = argv.includes("--yes");
const daysIdx = argv.indexOf("--older-than-days");
const olderThanDays =
  daysIdx !== -1 ? Number(argv[daysIdx + 1]) : DEFAULT_OLDER_THAN_DAYS;

if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) {
  console.error("--older-than-days must be a positive number");
  process.exit(2);
}

// ---------- helpers ----------

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GET ${url} -> ${res.statusCode}: ${body.slice(0, 300)}`));
          } else {
            resolve(JSON.parse(body));
          }
        });
      })
      .on("error", reject);
  });
}

function deleteDoc(docName, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://firestore.googleapis.com/v1/${docName}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`DELETE ${docName} -> ${res.statusCode}: ${body.slice(0, 300)}`));
          } else {
            resolve();
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

// Firestore REST field decoding (only the types rooms actually use).
function fieldValue(v) {
  if (v === undefined || v === null) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  return undefined;
}

async function listAllRooms() {
  const docs = [];
  let pageToken;
  do {
    const url = `${BASE}/rooms?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const page = await getJson(url);
    for (const d of page.documents || []) docs.push(d);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return docs;
}

function ageDays(iso) {
  return (Date.now() - Date.parse(iso)) / MS_PER_DAY;
}

// ---------- main ----------

(async () => {
  console.log(`Project:   ${PROJECT}`);
  console.log(`Threshold: last server write > ${olderThanDays} days ago`);
  console.log(`Mode:      ${wantDelete && confirmed ? "DELETE" : "DRY RUN (no writes)"}\n`);

  const docs = await listAllRooms();
  console.log(`Fetched ${docs.length} room docs.\n`);

  const candidates = [];
  const skipped = [];

  for (const d of docs) {
    const id = d.name.split("/").pop();
    const f = d.fields || {};
    const roomName = fieldValue(f.roomName);
    const roomType = fieldValue(f.roomType);
    const lastWriteDays = ageDays(d.updateTime);

    const isRehearseId = id.startsWith("rehearse-");
    const looksRehearsal =
      roomName === "Private Rehearsal" || roomType === "rehearsal";

    let reason = null;
    if (!isRehearseId) reason = "id not rehearse-*";
    else if (PROTECTED.has(id)) reason = "protected";
    else if (!looksRehearsal) reason = `unexpected shape (roomName=${JSON.stringify(roomName)})`;
    else if (lastWriteDays <= olderThanDays)
      reason = `active ${lastWriteDays.toFixed(1)}d ago`;

    const row = {
      id,
      roomName,
      roomType,
      lastWrite: d.updateTime,
      ageDays: lastWriteDays,
      docName: d.name,
    };
    if (reason) skipped.push({ ...row, reason });
    else candidates.push(row);
  }

  candidates.sort((a, b) => b.ageDays - a.ageDays);

  console.log(`=== DELETION CANDIDATES (${candidates.length}) ===`);
  for (const c of candidates) {
    console.log(
      `  ${c.id.padEnd(20)} ${String(c.roomName).padEnd(20)} last write ${c.lastWrite} (${c.ageDays.toFixed(1)}d ago)`
    );
  }

  const skippedRehearse = skipped.filter((s) => s.id.startsWith("rehearse-"));
  console.log(`\n=== SKIPPED rehearse-* rooms (${skippedRehearse.length}) ===`);
  for (const s of skippedRehearse) {
    console.log(`  ${s.id.padEnd(20)} kept: ${s.reason}`);
  }
  console.log(
    `\n=== Other rooms untouched: ${skipped.length - skippedRehearse.length} (public/named ensembles) ===`
  );

  if (!wantDelete) {
    console.log("\nDry run complete. Nothing was deleted.");
    console.log("To delete the candidates above: --delete --yes");
    return;
  }
  if (!confirmed) {
    console.log("\n--delete given without --yes. Nothing was deleted.");
    process.exit(2);
  }

  if (candidates.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  console.log(`\nDeleting ${candidates.length} rooms...`);
  const token = execFileSync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
  }).trim();

  let ok = 0;
  for (const c of candidates) {
    try {
      await deleteDoc(c.docName, token);
      ok++;
      console.log(`  deleted ${c.id}`);
    } catch (err) {
      console.error(`  FAILED  ${c.id}: ${err.message}`);
    }
  }
  console.log(`\nDone: ${ok}/${candidates.length} deleted.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
