# T16.1 — Authoritative Attempts and Round Outcomes

## Status and purpose

Implemented; first checkpoint in [T16](T16-synchronized-demonstration-and-scoring.md).
Implement server-owned demonstration actions and atomic round completion, not UI
controls, Continue, final results or T17 recovery policy.

## Scope

1. Inspect T15 serialization, command ledger, private codec, public projection,
   existing attempt contexts and pure T11 handlers. Before editing, state the
   concrete storage/history/attempt-version/rejection design. Follow the T16
   overview's review gate for any needed public animation metadata.
2. Extend private persistence for live attempt history, later bidders and Round
   Result. Keep existing valid records compatible; reject unknown/corrupt data
   instead of rebuilding/resetting. Validate legal history from round-start
   positions and agreement with stored current positions/counts and public state.
3. Accept existing `attempt.move`, `attempt.undo`, `attempt.reset` and
   `attempt.giveUp` through authenticated Room serialization. Enforce membership,
   active bidder, phase, match/round/attempt ID and current attempt version. Keep
   raw-size, rate, replay and capacity protections. No client positions/history.
4. Delegate to the pure reducer. Preserve free no-ops/corrections, bid limit and
   matching-color/vortex completion. Reaching the limit is not automatic failure.
   Give Up is an immediate request; add no confirmation requirement.
5. Keep a stable attempt ID while that attempt continues, and a monotonic version
   for accepted state changes. Undo/Reset must not rewind the version; domain
   no-ops do not masquerade as moves. A next bidder receives a fresh ID/version
   and all four round-start positions. Review exact semantics before coding.
6. Persist state, history/metadata, public revision and replay outcome atomically
   before acknowledgments/broadcasts. Successful movement awards once, commits
   all four final positions and enters Round Result in that same transition.
   Exhausted Give Up likewise enters a no-point result, not an invalid empty queue.
7. Exact retries after a later version, next bidder or round result must return
   their original outcome rather than move twice, skip another bidder or score
   twice. A new request with stale context fails. Do not reopen accepted bid order.
8. Preserve session-expiry scheduling and a no-timer demonstration. No host
   abandoned-attempt skip, grace period, automatic recovery or speculative moves.

## Likely files and checks

- Existing server command/transport/storage/projection modules and focused Worker,
  WSS and persistence tests; narrow shared changes only after a concrete review.
- Tests: active/non-active/host permissions, malformed/foreign/stale contexts,
  blocked moves, Undo/Reset no-ops, bid-limit corrections, immediate Give Up,
  same-target next bidder, colored/vortex success, all-four-position rollback and
  carry-forward, exactly-once scores, conflicting IDs and transaction rollback.
- Validate history/metadata corruption fails closed and public messages do not
  include history, proofs, credentials or private diagnostic authority.
- Run relevant server/shared/match tests and type checks; record commands/results.

## Completion and stop

Real authenticated commands can update one durable attempt or atomically finish
the round; connected clients receive the same validated snapshots. Existing UI
may still lack usable controls/result presentation until T16.2/T16.3. Stop there;
do not implement the next checkpoint or modify engine rules to simplify routing.

## Implementation and verification record

- The authenticated WebSocket allowlist now accepts the four existing attempt
  requests. The serialized command handler checks exact match/round/attempt ID
  and version, then uses the pure reducer with the authenticated actor. Hosts
  have no extra demonstration permissions. Give Up needs no confirmation.
- Private version 4 stores live/later attempts or Round Result. Valid versions
  1–3 remain readable; the first accepted attempt change upgrades the record
  without changing its identity. A continuing attempt increments its version
  on accepted moves/Undo/Reset; no-ops/rejections change neither it nor revision.
  Next bidders receive a fresh UUID and version zero. Results have no live attempt.
- Retained history is replayed from round start, validating every direction,
  non-no-op endpoint, intermediate incomplete target, final positions/count,
  metadata and exact private/public shape. Replay uses one-move temporary history
  so each validation is linear in retained length rather than copying prefixes.
  No solver runs on restore. Results use existing strict public outcome/score/
  completion invariants and exact private/public agreement, not retained proofs.
- State/history/score/official positions/revision and original replay outcome
  share the existing SQLite transaction. Exact retries precede stale context
  checks after authentication/membership; they cannot move, give up or score twice.
- Existing 4 KiB inputs, session-shared rate budget, non-evicting 10,000 per-session
  and 100,000 per-room replay caps remain unchanged. No bid/history gameplay limit
  or new retention policy was added. History still costs linear storage and
  validation per read; this is not a hosted worst-case resource benchmark.
- Tests cover permissions/stale/foreign context, no-ops/corrections/bid limit,
  all-four-robot Reset/Give Up, fresh bidder identity, colored/vortex completion,
  exactly-once replay/conflicts, injected transaction failure and corrupted data.
  Two authenticated sockets receive identical rollover/result snapshots. Three
  new full-runtime restart cases preserve nonempty history after Reset (version
  3 with one retained move), a later bidder, and an exhausted Round Result.
- Full server suite passed with 178 Worker + 12 restart tests; two subsequently
  added regressions passed in the final 16-test attempt run. Shared 390 and match
  192 tests passed. `pnpm typecheck`, `pnpm build` and `git diff --check` passed.
  Known IoContext cancellation and Windows EBUSY
  temporary-directory cleanup warnings occurred; completed suites exited zero.
- No UI, protocol, gameplay rules, demonstration timer, Continue, Skip, rematch,
  automatic recovery, infrastructure or deployment changed. Device testing is
  not claimed. T16.2 still needs review of minimal context/revision-bound animation
  metadata: existing snapshots cannot reliably distinguish Reset from a normal
  one-robot move for spectators. No such wire extension was implemented here.
