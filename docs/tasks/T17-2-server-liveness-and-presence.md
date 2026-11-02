# T17.2 — Server Liveness and Durable Presence

Status: complete — implemented and verified on 2026-11-01.
Parent: [T17](T17-reconnection-and-room-lifecycle.md).

- Implement the reviewed, bounded heartbeat/liveness protocol and persisted
  server-detected offline times. Definitive closure is immediate; an unresponsive
  socket is detected in approximately 30 seconds under normal runtime scheduling.
- Aggregate all authorized live sockets per seat. A stale tab's close/heartbeat
  must not override a fresh binding; expired sessions cannot maintain presence.
- Restore/normalize lifecycle state on wake/restart and coordinate existing alarms.
  Publish authoritative presence only when it changes, not on every heartbeat.
- Preserve existing input limits and hibernation behavior; document heartbeat
  cost/rate accounting rather than silently defeating protections.

Test silent loss, clean close, same-seat tabs, stale attachments, boundary times,
session expiry, restart and unchanged game state. Run server/shared tests and type
checks. No host transfer, attempt skip, client auto-reconnect or room expiry yet.

## Implementation

- `packages/shared`: coordinated protocol v2, private connection ID in binding,
  strict bounded WebSocket-only `connection.ping` parser and private pong, exported
  ten-second interval/30-second lease constants. HTTP bootstrap never accepts a
  heartbeat. V1 live messages are rejected rather than silently upgraded.
- Added the approved lookup-only `command.retry` envelope for retained canonical
  v1 room receipts. Same room/member/command ID and canonical request are required;
  absent receipt returns `retry-not-found` without executing its original action.
  Existing private match versions, initialization data and replay bodies remain
  readable/unmodified. Later T17 command/public metadata extensions remain deferred.
- `presence.ts`: explicit versioned SQLite metadata, per-connection persisted
  leases/sequence/identity expiry, seat offline times and room empty-since
  foundation. Only authenticated, timely, valid incoming traffic renews a lease.
  Duplicate/decreasing heartbeat sequences, unknown connection IDs, invalid frames,
  outbound broadcasts and expired identities do not. Dead connections must rebind.
- Seat presence aggregates all valid tabs; the existing four-socket/session limit
  stays. Effective timeout time survives delayed alarms; clean loss uses detection
  time. Retired rows are removed. Presence metadata and public revision updates
  commit together, and unchanged presence does not revise/broadcast on heartbeats.
- Room startup migrates the additive presence tables and normalizes attachments;
  unknown/corrupt schema fails closed. Earliest lease/identity expiry shares the
  existing alarm with preparation and bidding. Losing all sockets cannot delete a
  still-due bidding/preparation alarm or reset a match/attempt/history/score.
- Minimal client keepalive is included so enforcing leases does not disconnect
  every idle browser until T17.3. It sends after binding/every ten seconds, uses
  the current private connection ID, validates pongs, and cancels on disconnect/
  rebind/unmount. Protocol mismatch displays update/reload feedback. This is not
  automatic reconnection, a browser watchdog, page-refresh recovery, or offline play.

No host transfer, grace eligibility/Skip Attempt, Leave/End Room or 30-minute
expiry was implemented. Empty/offline timestamps are a foundation only; no empty
deadline is enforced or advertised yet. No board renderer, solver or game rule
was changed. No new dependency, deployment, infrastructure or commit.

## Verification and limits

Controlled-clock real WSS tests cover renewal and unchanged public/replay state,
duplicates/invalid/wrong-connection pings, exact timeout, delayed alarms, outgoing
traffic, multiple tabs/late closes, rebinding, message budget, earlier identity
expiry, valid rejected-command renewal, old-version rejection, transactional
rollback and unsupported presence schemas. Controller reconstruction retains live
leases/sequence; a separate real Miniflare shutdown/recreation test proves an
overdue lease retires at its persisted effective deadline once without losing
membership. Full-match fixtures now send real heartbeats during controlled clock
advancement; long identity-expiry fixtures explicitly rebind rather than skipping
the new liveness rules.

An initial type check exposed a union-narrowing annotation and SQLite row-interface
constraint, both corrected. The first shared test run found an old unsupported-
version fixture still using v2; it was updated to reject v1. These were migration/
test issues, not a gameplay-rule change. Initial full workspace run passed 1,381
tests. A subsequent run hit the six-seat bidding fixture's former five-second
test-runner limit after adding real heartbeat traffic; its timeout is now 15
seconds. No production deadline/budget was increased. Final verification passed:

- `pnpm test`: **1,383 tests** — engine 102, puzzles 124, match 192, shared 405,
  web 327, server Workers 215 (including eight new presence cases) and 18 separate
  full-runtime persistence tests (including overdue lease recreation).
- `pnpm typecheck`: all workspace packages and server test types passed.
- `pnpm build`: production web build passed.
- `git diff --check` plus trailing-whitespace checks of new files: passed.

Existing Windows IoContext/EBUSY and alarm-cancellation warnings may
appear; do not broadly delete temporary files to hide them.

Local presence's initial six network scenarios took about 1.9 seconds combined;
this is test wall time, not a Worker CPU/storage/hosting benchmark. Every accepted
heartbeat currently persists one lease renewal and re-arms the earliest alarm
when needed, and validates session authority through Registry. At four live tabs,
normal heartbeat traffic consumes about 24 of the unchanged 120 inbound messages/
minute/session. No heartbeat fills the command ledger or pushes full snapshots
solely for keeping alive. Hosted cost/hibernation limits remain unverified and need
deployment review; no free-tier performance guarantee is implied.

No new owner/browser/device evidence is claimed. Both front/backend must be updated
together and old pages reloaded for protocol v2. Until T17.3, a suspended/lost
connection still requires explicit Reconnect; the server now reports it accurately.
