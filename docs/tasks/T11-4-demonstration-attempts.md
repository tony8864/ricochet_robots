# T11.4 — Demonstration Attempts and Atomic Round Resolution

## Status and goal

Implemented on 2026-10-25 after T11.3. Read the [parent task](T11-pure-match-state-machine.md),
[state design](T11-1-state-and-transition-design.md), product, and architecture.

Let the active bidder demonstrate using existing engine movement/history rules.
T11.5 subsequently completes skips, advancement, and results; T11.6 completes
full-match verification. The evidence below records the original T11.4 scope.

Handle corrections, give-up, success, and exhausted bidders without corrupting
official positions. This task ends at Round Result; advancing beyond it is T11.5.

## Required transitions

| Demonstration action | Result |
| --- | --- |
| Active bidder moves legally within bid, target incomplete | Updated provisional attempt |
| Active bidder sends blocked direction | No-op, even at the bid limit |
| Active bidder would add a move beyond bid | Reject; keep attempt available for correction |
| Active bidder undoes/resets | Updated attempt, or no-op if already empty/reset |
| Active bidder reaches target within bid | Round Result, one point, all four positions committed |
| Active bidder gives up; another bidder remains | Next bidder with fresh round-start attempt and own bid limit |
| Last bidder gives up | Round Result, no point, official positions unchanged |
| Wrong player or wrong phase sends an attempt command | Reject |

## Implementation steps

1. Add demonstration phase handlers and connect implemented commands through the
   reducer pattern established in T11.3. Reuse its deadline normalization and
   trusted-context checks rather than introducing another clock/action pipeline.
2. Read active seat and bid limit from the frozen queue entry; do not create
   independently editable duplicates. Verify the acting player is that seat.
3. Reuse `moveAttemptRobot`, `undoAttempt`, `resetAttempt`, target completion, and
   retained move counting. Do not rewrite sliding/collision/history behavior.
4. Determine whether a direction actually moves before enforcing the move cap.
   Reject an additional non-no-op move beyond the bid; a blocked direction counts
   as nothing. Reaching the limit does not automatically fail the attempt.
5. On success, perform the minimal atomic round-resolution transition described
   below. Do not leave a solved attempt open for undo, further movement, or a
   second point award.
6. On give-up, discard all provisional positions/history. Create the next attempt
   from the immutable round start; if the queue is exhausted, resolve without
   a scorer. Keep all bidders' final bids/order frozen.
7. Add focused engine-backed fixtures, rollback/commit tests, and API documentation.

## Atomic completion ownership

Success must award exactly one point, copy **all four** final attempt positions
to official positions, increment completed rounds once, record the success
outcome, and enter Round Result in one transition. Exhausted bidders must also
resolve the round once while preserving scores and official positions.

Implement a small shared completion helper if useful. These operations belong
in T11.4 because returning a half-resolved success would violate the state model.
T11.5 reuses that work for no-bid skip, round-result advancement, and final results;
it must not re-award points or re-commit positions on a later Continue action.

The current target is already used since its reveal in T11.2. Success and failure
do not append/remove that ID again. Preserve round target/start data for the
result; drop active attempt/deadline data from that phase.

## Acceptance tests

- Only the active bidder controls moves/undo/reset/give-up. Thinking/bidding and
  non-active players cannot simulate the board through match commands.
- No-op directions do not enter history or count, including at the bid limit.
  Extra legal moves over the limit fail without ending the attempt.
- Undo/reset are free, restore correct positions/history, and remain available
  at the move limit. Empty corrections are no-op.
- Success works exactly at and below the bid; a vortex accepts any robot and a
  colored target requires its matching robot. There is no demonstration timer.
- A helper-robot solution changes multiple robots; all four final positions are
  committed, one point is awarded, and completed-round count advances once.
- Giving up after moving multiple robots restores every round-start position
  before the next bidder. New history is empty and the next bidder's own bid
  applies. Official positions never reflect a failed attempt.
- Exhausted bidders produce no point and unchanged official positions. Invalid
  commands do not count as give-up or skip anyone's turn.
- After resolution, repeated/stale attempt commands cannot undo success, award
  another point, or resolve another round. General network command-ID retry
  deduplication remains later server work; do not claim it is implemented here.
- Late valid actions use the T11.3 expiry normalization, with permissions checked
  against the resulting phase. Rejected actions preserve any due expiry result.
- Frozen input, deterministic replay, target-used count, and round-start snapshot
  invariants hold on every success/failure path.

## Scope and verification

Do not add round-result advance, final standings, host no-bid skip, automatic
preparation, UI controls, or host skipping an active bidder. Reconnection grace
and abandoned-attempt authority remain later room tasks.

Run focused match tests/type checks, then workspace tests/type checks, production
build, and whitespace checks. Record actual results and changed exports/types.
Leave T11.5/T11.6 pending; do not commit or start another subtask automatically.

## Implementation evidence

- `demonstration.ts` handles active-bidder moves/corrections/give-up using engine
  attempt helpers; `completion.ts` atomically resolves success or exhausted bidders.
- `transitionMatch` accepts `DemonstrationStageAction`, reuses deadline/context
  handling, and validates movement payloads. Skip and advance remain excluded.
- Twenty-nine new tests cover exact/under-bid success, free correction and blocked
  moves at the limit, all four wildcard robots, colored matching, multi-robot
  commit/rollback, next-bidder limits, cumulative scores, stale/invalid commands,
  due-expiry permissions, and frozen-input replay.
- Result resolution commits all four positions and the point together on success;
  failures preserve official state. Used IDs are not appended again. Later actions
  cannot undo or double-score the result. No next-round selection occurs here.
- T11.5/T11.6 remain pending. No dependency, UI, networking, or commit was added.

## Recorded verification (2026-10-25)

- Match package: 150 tests passed, including 29 new demonstration tests.
- All 385 workspace runtime tests passed. After correcting a test-fixture count
  type, all 150 match tests were rerun successfully; workspace type checks and
  the web production build passed. Whitespace checks passed.
- Engine, puzzle data/selection, applications, and historical benchmarks are
  unchanged. No real timers, new dependencies, or automatic advancement were added.
