# T15.4 — Authoritative Bids and Bidding Deadline

## Status and goal

Implemented on 2026-10-31; automated verification passed. The owner reported it
works and requested T15.5; detailed device/recovery checks are tracked in the
[T15.5 ledger](T15-5-integration-verification-and-handoff.md).
Follows [T15.3](T15-3-connected-thinking-and-preparation-feedback.md).
Connect bids and the server clock through expiry into the first Demonstrating
attempt. Part of [T15](T15-server-owned-phases-bidding-and-timers.md).

## Server scope

1. Accept existing `bid.submit` requests through the authenticated serialized Room
   path. Validate current match/round, seat, phase and existing numeric bounds;
   retain raw-message/rate/replay protections. Clients supply neither trusted
   identity nor first-bid order/time nor deadline. Reuse the pure match reducer.
2. Any seated player can submit a positive integer bid regardless of others'
   bids. A player may lower, not raise, their own bid. Use existing pure behavior
   for equal-value submissions rather than inventing a rule. Preserve original
   first-accepted priority after revisions; deterministic Room order breaks equal
   timestamp ties, not nickname or client arrival-time claims.
3. The first accepted bid atomically enters Bidding and persists one absolute
   server deadline exactly 60 seconds later. Later bids, retries, rebinds and
   restarts must not extend or recreate it. State, public revision, replay outcome
   and durable due intent commit before acknowledgment/broadcast.
4. Extend private persistence/validation for Bidding and the fresh Demonstrating
   state, including queue, active attempt identity/version and positions. Preserve
   old valid Preparing/Thinking records; do not reconstruct a deadline on restore.
5. Multiplex the bidding deadline with preparation and session-expiry obligations.
   Expire without client traffic. Also normalize due expiry using trusted server
   time before relevant commands and authoritative reads/rebinds, so delayed
   alarms cannot admit late bids or return stale Bidding as current state.
6. At or after the deadline, reject new/revised bids while retaining any due
   expiry transition returned by the reducer. Persist that transition even if the
   triggering command is rejected. Repeated alarm/read/retry paths cannot create
   a second attempt or increment state twice for the same expiry.
7. Freeze the final ascending bid queue, using first-accepted priority for ties.
   Create exactly one initial active attempt from all four round-start positions;
   official positions and scores stay unchanged. Do not implement demonstration
   moves or scoring in this checkpoint.

## Client scope

1. Wire Place Bid to the real authenticated request using the latest context.
   Keep input drafts local, accepted bids authoritative and exact retries immutable.
   Show safe pending/rejection feedback; disable writes when disconnected or out
   of phase. Don't treat a click or successful send as bid acceptance.
2. Reuse Your Bid and Player Bids. Sort authoritative accepted bids ascending,
   unsubmitted last, ties by original acceptance priority. Preserve existing smooth
   reorder behavior and reduced-motion support; no optimistic accepted roster.
3. Keep the timer in the existing round header. Derive its display from the
   persisted server deadline and available server-time metadata, not a new local
   60-second timer. Document offset/delay limitations; reaching local zero never
   authorizes a phase change or late bid. Rebind uses the current server snapshot.
4. On authoritative Demonstrating, display target, active bidder, bid and move
   count from that snapshot. Keep movement/undo/reset/give-up disabled or absent
   until T16; never fall back to local attempt state. Do not expose Skip Round in
   connected mode before its server flow is implemented in T16.

## Likely files

- Existing Room command, scheduling and stored-match modules and server tests.
- `apps/web/src/lobby/liveLobbyClient.ts`, connected phase routing and existing
  bid/roster/header components, plus tests. Keep naming/refactoring narrow.
- Shared/pure packages only if an actual integration gap requires a tested small
  extension; existing bidding rules/protocol remain the source of truth.

## Checks and completion

- Controlled-clock tests: first bid, independent higher bids by other players,
  own lowering/raise rejection, equal-value behavior, original tie priority,
  simultaneous serialized bids, exact boundary before/at/after expiry, duplicates,
  stale round requests, late alarms and rejected actions that still commit expiry.
- Worker/WSS tests: matching two-/six-client snapshots, one deadline/attempt,
  no-client expiry, unauthorized requests, rollback and private/public consistency.
- Full runtime restart during Bidding preserves deadline and bids; before/after
  due rebind and delayed scheduling produce one correct Demonstrating state.
- Client tests: drafts/pending/lost-result retry, read-only board, countdown from
  server metadata, reordered bids and authoritative phase handoff.
- Run relevant tests/type checks, production build and whitespace checks; record
  actual manual PC/phone bidding results separately. Keep production at 60 seconds;
  use injected clocks in tests rather than commit a shortened testing timer.

Stop before attempts, scoring, Skip/Continue, match results or T17 recovery work.

## Implementation record — 2026-10-31

- Authenticated `bid.submit` now runs through the existing serialized Room path
  and shared replay ledger. The pure T11 reducer owns independent positive bids,
  own-only lowering, same-value no-op and original first-accepted tie priority.
  One trusted processing time is captured per command; no client time/actor/order
  is accepted. No protocol fields or gameplay constants changed.
- First accepted bid atomically stores private/public Bidding, a revision/replay
  outcome and one absolute 60-second deadline. Retries/reductions/reconnects do
  not restart it. Existing earliest-due scheduling now includes bidding alongside
  preparation/recovery and session expiry, even with no sockets.
- Private match version 3 adds strict Bidding and initial Demonstrating records;
  old v1/v2 states remain valid. Expiry generates and persists one attempt UUID,
  version zero, frozen queue and empty attempt from all four round-start robots.
  Corrupt context/queue/deadline/metadata/history/unknown fields fail closed. T16
  must explicitly extend the codec before accepting moves or later attempts.
- Due expiry is normalized before command/replay/capacity checks and on publish,
  authoritative membership/creation reads, socket binding/delivery and cold wake.
  A rejected late/stale bid can still commit expiry. Duplicate alarms/read/retry
  paths preserve the same attempt ID and never award points or reset positions.
- Connected Place Bid is enabled for every bound seat in Thinking/Bidding.
  Drafts stay in the existing card; a send/ack alone never shows an accepted bid.
  New writes wait for snapshot/result reconciliation. Lost replies retain exact
  requests and can be retried after reconnect or Demonstrating. Inline errors
  cover rejected/late bids. Accepted snapshot bids drive roster sorting/motion.
- New connected countdown is display-only, in the round header. It estimates
  server now from message send-time plus elapsed `performance.now()`, with no
  browser wall-clock authority or local reducer. Equal-time duplicate snapshots
  do not restart the estimate. Local zero disables fresh bids and waits for the
  server phase; no controller command or client-generated demonstration exists.
  Network delay can make the display late; suspension/clock behavior can reduce
  its accuracy. Server checks remain final; explicit rebind resynchronizes. T17
  still owns automatic mobile recovery and broader backgrounding guarantees.
- Demonstrating shows the authoritative target, active bidder/bid and move count,
  but no movement, undo/reset/give-up, Skip/Continue or scoring controls. The local
  simulator remains separate and its existing bid/countdown behavior is preserved.
- Tests include controlled boundary times, duplicate/conflicting IDs, rollback,
  stale contexts, two-/six-client WSS, no-socket expiry, missed-alarm reads and
  full runtime restart before/after due (including missing-alarm repair), plus
  client drafts/retry/clock/phase presentation. No sleeps or shortened game timer.
- Verification: workspace tests/type checks/build passed. After the final two
  added server checks, all 171 server tests passed (162 Worker + nine full-runtime
  restart tests) and server type checks passed again. Current totals verified:
  **1,238 tests** (102 engine, 124 puzzles, 192 match, 390 shared, 259 web, 171
  server). Whitespace checks passed. The first type-check run found overly broad
  test-helper request types; narrowed them to the bid request variant and reran
  successfully. No production rule fix was required by that type error.
- Known Worker IoContext cancellation/Windows EBUSY cleanup warnings remain;
  no broad cleanup attempted.
  No physical-device/visual check, hosting, commit or deployment is claimed.

## Owner checkpoint

Refresh the existing backend/frontend setup on PC and phone; create/join a room
and Start. Place a bid on either device: both should see the same accepted bid
and countdown. The other player may bid higher; a player may lower their own bid
but not raise it. At zero, both should show the same first demonstrator and bid,
with zero moves. Missing movement controls are intentional until T16. Record
actual device results before claiming this owner review passed.
