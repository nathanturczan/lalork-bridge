# Rehearsal Room Lifecycle & Cleanup

Canonical plan for issues
[#17](https://github.com/nathanturczan/scale-navigator-bridge-m4l/issues/17)
(lifecycle/TTL) and
[#18](https://github.com/nathanturczan/scale-navigator-bridge-m4l/issues/18)
(unlisted-but-joinable). Firebase project: `scale-navigator-ensemble`.

## Model

Rehearsal rooms (`rehearse-*`, auto-created by lalork-rehearse) are
**unlisted, not secured**: hidden from every public discovery surface, but
joinable by anyone who has the code. Real access control is out of scope
until authentication exists.

- Only the **broadcaster** (Rehearse app, as room host) refreshes
  `lastActiveAt`/`expiresAt`, on each harmony write. Listeners joining by
  code never keep a dead room alive. Firestore rules enforce this: `update`
  requires `hostId == request.auth.uid`.
- Firestore's native TTL policy deletes rooms after `expiresAt` passes
  (30 days of broadcaster inactivity, `REHEARSAL_EXPIRY_DAYS` in
  lalork-rehearse `src/roomLifecycle.js`).

## Code (branches, pending review/merge/deploy)

| Repo | Branch | Change |
|---|---|---|
| lalork-rehearse | `room-lifecycle-fields` | Writes `roomType: 'rehearsal'`, `lastActiveAt`, Timestamp `expiresAt` on creation; refreshes on broadcaster writes; backfills legacy rooms on next broadcast |
| Ensemble-Jammer | `rehearsal-room-privacy` | Lobby filter + "Join with rehearsal code" input; "Rehearsal code not found or expired" message |
| lalork-website | `hide-rehearsal-rooms-tv` | `/tv` picker filter |
| this repo | `rehearsal-room-cleanup` | `scripts/cleanup-rehearsal-rooms.js` (dry-run default) + this doc |

Filter predicate (kept identical in Jammer and Enter): hide when
`roomType === 'rehearsal'` OR id starts with `rehearse-` OR
`roomName === 'Private Rehearsal'`.

## Rollout order (do not reorder)

1. **Merge + deploy app code** (Rehearse first, then Jammer/Enter).
2. **Verify field types in production**: open a fresh rehearsal room doc in
   the Firestore console and confirm `expiresAt` shows as a **Timestamp**,
   not a number. TTL silently ignores non-Timestamp fields (the existing
   `createdAt`/`updatedAt` are epoch-millis numbers and would NOT work).
3. **Enable TTL** (reversible config; the deletions it causes are not):

   ```bash
   gcloud firestore fields ttls update expiresAt \
     --collection-group=rooms \
     --enable-ttl \
     --project=scale-navigator-ensemble
   ```

   Console alternative: Firestore → Time-to-live → Create policy →
   collection group `rooms`, field `expiresAt`.

   Verify / disable:

   ```bash
   gcloud firestore fields ttls list --project=scale-navigator-ensemble
   gcloud firestore fields ttls update expiresAt \
     --collection-group=rooms --disable-ttl \
     --project=scale-navigator-ensemble
   ```

   Notes: TTL deletion typically lands within 24h after expiry (not
   instant); TTL deletes bypass security rules; deleted docs are
   unrecoverable. Public rooms are safe because they simply never carry
   `expiresAt`.
4. **One-time sweep** for orphans TTL can't reach (see below), only after
   explicit approval of a dry run.

## Why TTL alone is not enough

TTL only deletes docs that HAVE `expiresAt`. Legacy rehearsal rooms get the
field backfilled only when their host broadcasts again — but **orphaned**
rooms (anonymous-auth UID rotated, so no client can ever write them again)
will never receive it. Those need `scripts/cleanup-rehearsal-rooms.js`.

```bash
node scripts/cleanup-rehearsal-rooms.js                    # dry run (default)
node scripts/cleanup-rehearsal-rooms.js --older-than-days 60
node scripts/cleanup-rehearsal-rooms.js --delete --yes     # after approval only
```

Candidates must pass ALL of: `rehearse-` id prefix, rehearsal shape
(name/roomType), server `updateTime` older than threshold, not in the
hard-coded protected list (`la-laptop-orchestra`). Deletes authenticate via
`gcloud auth print-access-token` (IAM bypasses the host-only delete rule).

Dry run of 2026-08-05: 50 rooms total, 28 `rehearse-*`, **0 candidates** —
every rehearsal room had been written within the last ~4 days. The sweep
becomes meaningful ~30+ days after the lifecycle deploy; re-run it then.

## Firestore rules: get vs list (deferred)

Deployed rules (identical to `scale-navigator-dashboard/firestore.rules`)
give `rooms` a blanket `allow read` (get + list). A rules-level split —
`allow get: if true;` plus a `list` rule that excludes rehearsal rooms — is
**not cleanly feasible yet**: list rules constrain the query, so every
client would need `where('roomType', '!=', 'rehearsal')`, which also
excludes all legacy public rooms that lack `roomType`.

Feasible later: backfill `roomType: 'public'` onto named ensembles, switch
clients to the filtered query, then tighten `list`. Until then, filtering
is client-side only, and codes remain guessable-in-principle; acceptable
for the current threat model (clutter, not secrets).
