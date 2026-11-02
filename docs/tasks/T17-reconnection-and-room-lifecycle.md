# T17 — Reconnection and Room Lifecycle

## Status and goal

In progress after T16; T17.1's design is approved and T17.2 server liveness is
implemented/verified (1,383 workspace tests, types/build passed, 2026-11-01).
T17.3 automatic recovery is implemented/verified (1,430 workspace tests, types/
build passed). T17.5 guest departure is implemented with automated checks passed;
its core owner-guided smoke checks subsequently passed. T17.4 server-owned bidder
grace and confirmed Skip Attempt are implemented and core owner smoke checks
passed. T17.6 host closure is implemented and automated-verified; the owner
accepted its core manual checks. T17.7 empty expiry is implemented; the owner
confirmed the 10-second local expiry check. T17.8 combined automated verification
passed (1,530 tests, types/build/whitespace). The owner subsequently confirmed
combined multi-tab presence, host absence/return, round-result refresh, phone
lock/resume, Wi-Fi recovery and final-results refresh on both devices. Guided core
checks passed; broader device-coverage limits remain tracked in its checklist.
Restore the same authenticated seat after connection
loss/backgrounding, report presence reliably, and resolve abandoned attempts and
rooms without changing bidding, scoring or movement rules. No implementation is
authorized by writing this plan. Implement one explicitly requested subtask at a
time; do not commit, deploy or begin T18 automatically.

Read `AGENTS.md`, product, architecture, plan, shared protocol README and the
selected subtask before coding. Preserve unrelated uncommitted header/UI changes.

## Approved direction

- Automatically reconnect after transient loss/resume, with visible feedback and
  manual Reconnect fallback. Keep the last board read-only until authenticated
  binding and a current authoritative snapshot complete. Never queue offline bids
  or movement. Preserve uncertain commands for exact retry, not new IDs.
- Detect unresponsive connections after approximately 30 seconds; a definitive
  close may be recognized immediately. A seat is online while any authorized tab
  remains responsive. Browser suspension is normal, not a cheating signal.
- A disconnected active bidder has 60 seconds from server-detected disconnection
  to return. If already offline when their attempt starts, begin grace then.
  Preserve history, count and provisional positions. After grace, only the host
  may confirm Skip Attempt; do not automatically forfeit. Rebind before acceptance
  removes skip eligibility. Skip rolls all four robots back and advances the queue
  exactly like Give Up. Connected demonstrations still have no timer.
- Keep accepted bids and original first-bid priority; the bidding deadline never
  pauses. Do not silently remove disconnected bidders or replace match seats.
- **No host transfer.** The original host retains authority. Other connected
  players may continue permitted actions, but host-only operations wait for the
  host. No guest takeover or emergency host privileges.
- Preserve the room when everyone disconnects. Bidding still expires; results
  wait for the host and abandoned attempts require the authorized host action.
- Expire after **30 continuous minutes with nobody connected**. An authenticated
  reconnect before expiry cancels this countdown. Do not expire an online room
  merely because nobody moves/bids; heartbeat traffic must not keep an empty room
  alive. Fixed 24-hour identity expiry remains separate and is not extended.
- Guests will get Leave Room; the host instead gets End Room. Both require
  confirmation. End Room closes the room for everyone rather than producing a
  fabricated completed-match winner or starting another match. Old code/invites
  must no longer admit players. New Match remains the separate finished-match
  action that keeps players together.

## Ordered subtasks

- [x] [T17.1 — Lifecycle design and contracts](T17-1-lifecycle-design-and-contracts.md)
- [x] [T17.2 — Server liveness and durable presence](T17-2-server-liveness-and-presence.md)
- [x] [T17.3 — Automatic client recovery](T17-3-automatic-client-recovery.md)
- [x] [T17.4 — Disconnected bidder grace and Skip Attempt](T17-4-bidder-grace-and-skip.md) (core owner smoke checks passed)
- [x] [T17.5 — Guest Leave Room](T17-5-guest-leave-room.md) (core owner smoke checks passed)
- [x] [T17.6 — Host End Room](T17-6-host-end-room.md) (core owner checks passed)
- [x] [T17.7 — Empty-room expiry and cleanup](T17-7-empty-room-expiry.md) (owner short-timeout expiry check passed)
- [ ] [T17.8 — Recovery and lifecycle verification](T17-8-recovery-and-lifecycle-verification.md) (automated/core guided checks passed; broader device coverage open)

## T17.1 review decisions (approved 2026-11-01)

Guest Leave exits only the current tab's view/transport while reserving the seat,
scores and bids in all phases, including lobby. Other tabs remain connected; no
seat is freed. Active-bidder Leave uses normal disconnect grace if the final tab
closes, not implicit Give Up. Protocol v2/retained receipt lookup, heartbeat/retry
scheduling and bounded terminal retention/tombstones are approved as specified in
T17.1. T17.2 implements heartbeat/lease/protocol foundations and T17.3 automatic
client recovery. T17.5 implements departure without a server membership mutation;
T17.4 implements grace/skip and T17.6 implements terminal host closure. T17.7
implements open-room empty expiry.

Review exact retry/heartbeat scheduling, close/expiry contract compatibility,
terminal messaging/routing, cleanup/tombstone retention and both confirmation
designs before their implementation. Distinguish explicit host closure from room
expiry, expired identity and transient failure. Do not silently refresh credentials
or create a replacement seat on failed resume. Ask before any unresolved fairness,
security, retention or material architecture choice.

## Safety and completion

Server time, phase, seat and current liveness authorize transitions, never a UI
countdown. Persist lifecycle deadlines across restart and normalize due work on
wake/requests, not just alarms. Coordinate the earliest alarm with existing
preparation, bidding and session expiry; do not replace those obligations.
Runtime-validate new contracts, keep credentials/history/private proofs private,
retain exact-retry safety, and fail closed for terminal rooms. Keep persistent
schemas compatible; do not wipe development rooms to implement migrations.

Tests must cover boundary races, stale sockets/multiple tabs, delayed old callbacks,
duplicate actions, full runtime restarts, transactional failure and terminal-state
non-resurrection. Controlled clocks/fixtures replace real sleeps. Add owner-guided
PC/phone checks and record device/browser details and actual evidence separately
from automated results. Keep T15 solver/preparation and hosted-resource limits
explicit; T17 does not solve unavailable target preparation or certify deployment.

Complete only after the requested implementation and verification pass or the
owner accepts documented limits. Stop before T18, deployment or commit.
