# T11 — Pure Match State Machine

## Status and goal

Complete through T11.6 on 2026-10-25: state/contracts, creation, verified T10 preparation,
bidding/deadline, active-bidder attempts, rollback, atomic round resolution,
no-bid skip, advancement, final results, and deterministic full-match verification.
This completes the pure model, not UI or authoritative multiplayer integration.
See `T11-1-state-and-transition-design.md`
and the usage example in `packages/match/README.md`.

Implement the deterministic rules that connect verified round setup, bidding,
demonstrations, scoring, and ten-round progression. This is the pure match model
for the later local prototype and authoritative server. Keep the board fixed
and preserve all four official robot positions correctly between attempts and
rounds.

Read `docs/product.md`, `docs/architecture.md`, and the T10 task before coding.
Product rules win. T11 does not authorize multiplayer infrastructure, UI, or a
new recovery policy for puzzles that cannot be verified.

## Dependencies and placement

- Reuse engine movement, `AttemptState`, `createAttempt`, `moveAttemptRobot`,
  `undoAttempt`, `resetAttempt`, move counting, and target completion.
- Reuse `@robot-puzzle/puzzles/round-setup` for target selection. Do not duplicate
  its filtering, solver, search budgets, or verification rules.
- Keep match phases and player/bid rules separate from geometry. The existing
  game engine must remain independent of the puzzles package and room authority.
- Location established by T11.1: the small `packages/match` workspace package,
  importable by both the T12 local prototype and future server. Its boundary is
  recorded in `docs/architecture.md`; do not create circular dependencies or
  import server-app internals into web.
- No new runtime libraries, state-management frameworks, or timer dependencies
  are needed. A small workspace package is a code boundary, not infrastructure.

## State and transition contract

Use immutable discriminated state and command/result types. Represent these
phases explicitly (names may follow implementation conventions):

```text
PREPARING -> THINKING -> BIDDING -> DEMONSTRATING -> ROUND_RESULT
                |                        |              |
                +-- confirmed no-bid skip +--------------+
                                                        |
                                   PREPARING (next round) or FINISHED
```

During demonstrations, a give-up advances to the next eligible bidder or to the
round result if none remain. A successful attempt goes straight to round result.
Preparation failure remains in PREPARING with a reason, without starting a round.

State must account for:

- A fixed roster of 2–6 distinct stable seat IDs, host identity supplied through
  trusted context, player display data as needed, and scores starting at zero.
- Locked board identity/geometry, official positions, used target IDs, completed
  round count, current round number/target, and round-start robot positions.
- Each player's final bid, original first-accepted ordering, absolute deadline,
  frozen demonstration order, active bidder, bid limit, and attempt history.
- Round outcome, scorer if any, and final standings/shared winners.
- Preparation diagnostics/reason as internal data where needed. Solution proofs
  must not become ordinary public match state or player-facing hints.

Expose clear pure operations for match creation, round preparation/acceptance,
bid submission, deadline advancement, moves, undo/reset, give-up, confirmed
no-bid skip, and advancing past round results. Return the next state and an
explicit accepted/no-op/rejected outcome with a useful reason.

Actor identity in this layer is trusted caller context, not a credential supplied
by a client. Check phase, roster membership, active bidder, and host-only no-bid
skip here; credential validation and network authorization belong to later server
tasks. Capture the current host from context rather than implementing host
transfer or assuming the original host can never change.

## Connecting T10 to round start

1. Begin in PREPARING with the selected board and initial official positions.
   Obtain candidate ordering and search budgets from the caller, with no internal
   randomness, clocks, or implicit retries.
2. Pass the locked board, all current official positions, and used target IDs to
   T10. Use a small pure coordinator or supplied preparation result so ordinary
   bid/move transitions do not rerun the solver.
3. Accept only trusted internally prepared data matching the locked board,
   current official positions, and an unused, non-complete target from that
   board. Reject stale preparations and preparations for another board.
4. On acceptance, atomically establish round-start positions, reveal the target,
   append its ID to used targets, clear old bidding/attempt state, and enter
   THINKING. The first round is 1; preparation itself does not complete a round.
5. Preserve the target's used status after success, failure, or skip.
6. On T10 `deferred` or `unavailable`, keep official positions, scores, used IDs,
   and completed-round count unchanged. Store an explicit reason, reveal no new
   target, and do not enter thinking with an unverified target.

The match model may accept a later explicit preparation attempt, but it must not
schedule background work or automatically loop. Live retry scheduling, recovery
UX, and server-runtime limits remain unresolved integration work. Do not reset
robots, change the board, repeat targets, shorten the match, or count failed
preparation as a skipped round.

## Thinking, bids, and deadline

- Thinking has no automatic deadline. The first accepted positive integer bid
  starts BIDDING with an absolute deadline exactly 60,000 ms after supplied time.
- Every player may submit a bid regardless of other players' bids. Do not require
  undercutting the leading bid, and do not cap bids at the solver's solution length.
- A player may lower their own bid, never raise it. An identical resubmission can
  be an explicit no-op; it must not change priority or extend the deadline.
- Preserve each player's first accepted bid order after reductions. Sort by final
  bid ascending, then original first acceptance; a monotonic acceptance sequence
  deterministically resolves equal timestamps. This implements the AGENTS rule
  of earlier first accepted bid rather than ordering by latest revision time.
- Inject authoritative time into transitions. Do not use `Date.now`, browser
  timers, or real sleeps. Validate supplied timestamps and safe deadline arithmetic.
- Bids/revisions at or after the deadline are rejected, even if a scheduled expiry
  transition has not run. Ensure expiry is enforced from supplied time; a late
  command must not keep bidding open. Tests cover before, exactly at, and after.
- On expiry, freeze final bids/order and start the first eligible bidder's attempt.
  Non-bidders do not enter the demonstration queue. No new/revised bids follow.
- Reject zero, negative, fractional, non-finite, and unsafe integer bids. Accept
  positive safe integers without inventing a smaller gameplay cap. Any additional
  maximum accepted bid remains a separate product decision.

## Demonstrations and commitment

- Only the active bidder may move, undo, reset, or give up. Reject board commands
  during preparation, thinking, bidding, round results, and after match end.
- Each attempt begins with all four robots at round-start positions and no moves.
  Keep provisional attempt positions separate from official committed positions.
- Reuse legal slides. No-op directions count as zero moves and add no history.
- Count only retained moves. Undo/reset are free; reset restores every robot to
  round start. Empty undo/reset may return no-op.
- Reject a move that would add a retained move beyond the bid. At the limit,
  continue allowing undo/reset/give-up; reaching the limit alone does not fail an
  attempt. A blocked input remains a no-op, not a counted move or failed attempt.
- Immediately recognize completion within the bid, including fewer moves than
  bid and wildcard completion by any robot. Do not add a demonstration timer.
- Success awards exactly one point, commits all four final positions, and ends
  the round. Disallow later commands that could undo success or award twice.
- Give-up discards all provisional changes. The next bidder starts from the same
  round-start positions, with a fresh history and their own bid limit.
- If every bidder gives up, award no point, keep official positions unchanged,
  and finish the round. Invalid commands do not automatically count as give-up.
- A host-confirmed no-bid skip is legal only in THINKING before any accepted bid;
  it awards no point and preserves official positions. Confirmation UI is T12.
  Do not introduce a host power to skip an active attempt here: disconnect grace
  and abandoned-attempt authorization belong to later room/reconnection tasks.

## Ten-round progression and finish

Keep ROUND_RESULT stable until an explicit trusted advance operation. Automatic
screen timing or who clicks a future Continue button is outside this pure model.

Each successful, exhausted-bidder, or confirmed no-bid-skipped round counts once.
After rounds 1–9, advancing requests preparation from the current official
positions and accumulated used IDs. After round 10, enter FINISHED without
selecting an eleventh target. Preparation failure does not advance the count.

Produce standings ordered by score and identify every highest-scoring player as
a shared winner, including an all-zero tie. Any display ordering among tied
players must not create a tiebreak winner. Reject further gameplay after finish.
Rematch confirmation, lobby membership, and reconnect behavior remain later work.

## Implementation steps

The owner requested these as six reviewable subtasks. Complete them in order;
requesting one does not authorize implementing the remaining subtasks:

- [x] [T11.1 — State and transition design](T11-1-state-and-transition-design.md):
  reviewed match data/invariants and readonly TypeScript contracts, with contract tests.
- [x] [T11.2 — Match creation and round preparation](T11-2-match-creation-and-round-preparation.md):
  validated creation, input snapshots, verified T10 acceptance, and atomic reveal.
- [x] [T11.3 — Bidding and deadline](T11-3-bidding-and-deadline.md):
  bids, supplied-time expiry, demonstration order, and first-attempt initialization.
- [x] [T11.4 — Demonstration attempts](T11-4-demonstration-attempts.md):
  active-bidder controls, corrections, rollback, and atomic success/exhausted-bidder resolution.
- [x] [T11.5 — Round and match completion](T11-5-round-and-match-completion.md):
  no-bid skip, result advancement, next-round preparation, final standings/shared winners.
- [x] [T11.6 — Full-match verification](T11-6-full-match-verification.md):
  complete simulated matches, cross-phase coverage, documentation, and final checks.

Each implementation subtask adds its focused tests. T11.6 adds integration and
full-flow coverage; it does not postpone correctness tests until the end.

T11.4 must resolve success atomically, including its point, all four committed
positions, and completed-round count. T11.5 reuses that completion work rather
than applying scoring again when advancing past the result. This keeps the
subtasks sequential without leaving an invalid half-resolved successful state.

1. Settle package placement, define state/command/result types, and document core
   invariants and trusted-context boundaries.
2. Implement validated match creation and T10 round acceptance/preparation paths.
3. Implement bids, supplied-time expiry, and deterministic final bidder ordering.
4. Wrap existing attempt helpers with phase/actor/bid checks and success handling.
5. Implement give-up rollback, no-bid skip, round outcomes, advancement, and finish.
6. Add focused transition tests, then deterministic T10 integration scenarios.
7. Update package documentation, architecture boundaries, and plan with actual
   behavior and verification. Do not modify UI or network contracts incidentally.

## Acceptance tests

- Creation validates roster, fixed board, and starting state without mutation.
- First bid starts one 60-second window; later bids/reductions never extend it.
- Higher bids from other players remain allowed; own raises and malformed bids
  fail. Tie priority survives reductions and equal accepted timestamps.
- Expiry boundaries work without real timers, including late incoming commands
  before an alarm has been processed and repeated deadline advancement.
- Phase/actor checks prevent unauthorized moves, bids, give-up, and no-bid skips.
- Legal moves, no-ops, undo/reset, bid limit, under-bid success, wildcard success,
  and free correction at the move limit follow existing rules.
- A successful attempt moves at least two robots; all four final positions carry
  forward, score increments once, and late attempt commands cannot change it.
- Giving up after moving multiple robots restores every robot before the next
  bidder, clears history, and preserves the next bidder's own bid limit.
- Exhausted bidders and confirmed no-bid skips give no points, preserve positions,
  consume exactly one revealed round, and keep its target used.
- T10 integration uses actual current positions; rejects stale/wrong-board/used
  preparations; and keeps all official state intact on deferred/unavailable results.
- A deterministic complete ten-round scenario exercises success and no-point
  outcomes, target non-repetition, the fixed board, final standings, and no
  eleventh-round setup. Include equal top scores and an all-zero shared win.
- Rejected/no-op/repeated actions cannot double-award or double-advance. If time
  expiry legitimately changes phase while a command is rejected, test and
  document that explicitly rather than silently losing the expiry transition.
- Frozen-input and replay tests establish immutability and determinism. Use a
  controlled preparer for targeted transition fixtures and at least one real T10
  integration path; do not fake all solvability checks or rely on timing assertions.

## Verification and completion

Run relevant package tests/type checks and workspace tests, type checks, production
build, and whitespace checks. No additional solver benchmark run is needed unless
solver/selection behavior changes; preserve T09/T10 measurement artifacts.

Complete only when the pure rules and T10 integration are verified, documentation
matches the implementation, and remaining live recovery/reconnection decisions
are recorded. Do not claim multiplayer readiness or guaranteed ten-round target
supply from a passing local match fixture. Do not commit or begin T12 automatically.

## T11.2 completion evidence (2026-10-24)

- `createMatch` validates and copies match ID, fixed roster, and full board data;
  initializes zero scores and initial positions; and returns Preparing without
  selecting a target.
- `prepareMatchRound` snapshots current preparation context, calls the real T10
  selector once, and uses an internal acceptance handler. Verified results enter
  Thinking and mark the target used atomically. Proofs do not enter match state.
- Stale match/round/geometry/position/used-ID contexts and invalid target/start
  data or witnesses are rejected without state changes. Deferred and unavailable
  results preserve official state and keep the next target unrevealed.
- Fifty-seven new runtime tests cover creation, all five real boards, multi-robot
  carry-forward fixtures, repeated/stale/invalid results, explicit retry, and
  immutability. Match package: 64 tests including T11.1's seven contract checks.
- All 299 workspace tests, workspace type checks, production build, and whitespace
  checks passed. Existing game engine, puzzles, board definitions, UI, and T09/T10
  measurement artifacts are unchanged. No new dependency or commit was added.
- The full reducer, bids, demonstrations, round progression, and live recovery
  scheduling remain T11.3 onward; no later subtask was started automatically.

## T11.3 completion evidence (2026-10-25)

- Incremental `transitionMatch` routes the implemented bidding-stage commands to
  focused handlers. T11.2 preparation acceptance is available on the controller
  path; T10 selection remains an explicit separate call.
- Bids, own reductions/no-op resubmission, absolute 60-second expiry, original
  acceptance priority, frozen queue, and first-attempt initialization are verified.
  Due expiry is retained even when a late bid/unknown actor is rejected.
- Fifty-seven new tests bring the match package to 121 tests and the workspace to
  356. All tests, type checks, web build, and whitespace checks passed.
- T11.4–T11.6 remain pending. No interactive attempts, score awards, round advance,
  new dependency, UI change, or commit was added by this subtask.

## T11.4 completion evidence (2026-10-25)

- Active-bidder commands now reuse engine movement/history and the common
  deadline pipeline. Free no-ops/corrections, retained-move limits, target matching,
  and no demonstration timer are preserved.
- Success atomically awards one point, copies all four final positions, resolves
  the round once, and drops live-attempt data. Give-up rolls all robots back for
  the next bidder; exhausted bidders resolve without points or position changes.
- Twenty-nine new tests bring the match package to 150 tests and workspace runtime
  coverage to 385 passing tests. Workspace type checks and web build passed;
  the corrected later-round test fixture was rerun with all match tests.
- T11.5/T11.6 remain pending. No UI, network, dependency, or commit was added.

## T11.5 completion evidence (2026-10-25)

- Confirmed current-host skip reuses atomic no-point completion, only in Thinking.
  Explicit controller advance preserves committed data and enters Preparing after
  rounds 1–9 or Finished after round 10, without running target selection.
- `transitionMatch` now implements the full `MatchTransition` contract.
  `getMatchResults` derives ordered standings and every shared winner, including
  all players with zero points. Advancement never scores a completed round again.
- Thirty-nine new tests bring match coverage to 189 and workspace coverage to
  424 passing tests. Workspace type checks, production build, and whitespace
  checks passed. Existing carry-forward tests now use real advance.
- T11.6 remains pending. No UI, network, solver, dependency, or commit was added.

## T11.6 completion evidence (2026-10-25)

- Audited every reviewed transition and rejection category against focused tests;
  the coverage map is in `T11-6-full-match-verification.md`.
- Three new tests verify the exact runtime exports and complete two-/six-player
  ten-round scripts using real T10 selections. Mixed outcomes include helper and
  wildcard success, at-limit corrections, multi-robot rollback, shared 2–2 winners,
  and a separate all-zero match. Every action checks state invariants; replayed
  mixed-match traces are identical and frozen inputs remain unchanged.
- Real deferral and controlled unavailability preserve committed data between
  rounds, followed only by explicit bounded retry. No eleventh target is selected.
- All 192 match tests / 427 workspace tests, TypeScript checks, production build,
  and whitespace checks passed. No production rule defect or dependency change
  was needed; API/docs/status drift was reconciled. Benchmarks are unchanged.
- All six subtasks and parent T11 are complete. T12 remains pending; live recovery,
  Cloudflare measurement, network authority/retry safety, durability, and reconnect
  work are not completed by pure tests. Nothing was committed.
