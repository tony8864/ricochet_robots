# T11.5 — Round Results, Advancement, and Match Completion

## Status and goal

Implemented on 2026-10-25 after T11.4. Read the [parent task](T11-pure-match-state-machine.md),
[state design](T11-1-state-and-transition-design.md), product, and architecture.
T11.6 subsequently completes full-match verification; the evidence below records
T11.5's implementation-time scope and results.

Complete the lifecycle around resolved rounds: confirmed no-bid skip, explicit
advance, next-round preparation, ten-round termination, and shared winners.
T11.4 already owns atomic success/exhausted-bidder resolution and scoring; reuse
it rather than awarding points or committing positions again when advancing.

## Required transitions

| Starting state/action | Result |
| --- | --- |
| Thinking: current host confirms no-bid skip | Round Result, no point, same official positions |
| Round Result after rounds 1–9: trusted advance | Preparing, with carried official positions and used IDs |
| Preparing: explicit preparation succeeds | Thinking through existing T11.2 path |
| Preparing: explicit preparation fails | Remain Preparing; no new revealed/consumed round |
| Round Result after round 10: trusted advance | Finished, without an eleventh target search |
| Finished: gameplay or round advance | Reject without changes |

## Implementation steps

1. Add host-confirmed no-bid skip only in Thinking, where no bid has yet been
   accepted. Use current host identity from trusted context and check the actor.
   Reject unconfirmed, non-host, and wrong-phase skip requests.
2. Reuse the T11.4 no-point completion helper: preserve official positions and
   scores, record `no-bid-skip`, increment completed rounds once, and retain the
   already-used target. Do not add host power to skip an active demonstration.
3. Implement controller-owned round-result advancement. Keep Round Result stable
   until an explicit advance; neither timers nor final animation frames trigger it.
4. Before ten completed rounds, enter Preparing with the current official positions,
   scores, board, roster, and used IDs. Remove old round/bid/attempt fields. Target
   selection occurs only through the explicit existing T11.2 coordinator.
5. After ten completed rounds, enter Finished directly. Do not call T10 or create
   round 11. Preserve final positions/scores and derive standings/shared winners.
6. Return every highest-scoring seat as a winner. Stable roster order may organize
   tied display rows but must not break the tie, including an all-zero match.
7. Complete the implemented reducer entry point against the T11.1 `MatchTransition`
   contract, with small phase handlers and the shared deadline-normalization path.
   Keep public helpers and rejection/no-op behavior documented consistently.

## Data and counting invariants

Resolve a revealed round once on success, exhausted bidders, or confirmed skip.
Advance does not resolve it again. Used-target IDs are appended only on reveal,
not on completion/advance; they remain used on every no-point outcome.

During active round N, completed rounds equal N−1. In its Round Result, completed
rounds equal N. Preparing has no active target. Failed preparation never changes
that count, scores, positions, or used IDs, and is not a skipped round.

Successful official positions come from the entire four-robot attempt committed
in T11.4; no-point outcomes keep the round-start official positions. Never reset
to catalog starts between rounds or substitute solver-final positions.

## Acceptance tests

- Current-host confirmation is required for a no-bid skip. No bid/timeout starts;
  all four positions and scores remain unchanged and one round resolves.
- Skip is rejected after the first accepted bid and during demonstrations/results.
  A changed current host context is honored without mutating roster or adding
  host-transfer logic to the pure model.
- Round Result remains stable across ordinary rejected commands until explicit
  trusted advance. Repeating advance cannot double-count or skip a round.
- Success, exhausted bidders, and no-bid skips each contribute exactly one
  completed round and preserve used IDs correctly.
- Advancing after a multi-robot success preserves all four committed positions;
  real T10 next preparation sees those positions and cannot repeat used targets.
- Deferred/unavailable preparation after advance preserves the last committed
  state and completed-round count; explicit retry does not consume another round.
- Round 10 finishes once with no eleventh preparation. Further gameplay/advance
  cannot change final state or scores.
- Standings are score-ordered; tied leaders share the win; all-zero scores produce
  all players as shared winners. Display ordering is not a tiebreak.
- Phase variants contain only appropriate round/attempt/deadline data; frozen
  input, deterministic outputs, and all prior T11 tests remain valid.

## Scope and verification

UI Continue buttons/auto-advance timing, rematch confirmation, lobby behavior,
reconnection, network authentication/deduplication, and automatic recovery jobs
remain later work. Do not resolve the open live recovery policy by changing the
board, resetting robots, repeating targets, or shortening the match.

Run focused match tests/type checks and complete workspace tests/type checks,
production build, and whitespace checks. Update README/task/plan with actual
behavior and results. Keep T11 incomplete until T11.6's full-flow verification;
do not commit or start T12 automatically.

## Completion evidence

- `advancement.ts` handles confirmed current-host skip and controller advancement;
  skip reuses `completion.ts`, while advance never awards or commits again.
- `standings.ts` exports `getMatchResults` and readonly result/standing types.
  All highest-scoring seats share victory; roster order only controls tied display.
- `transition.ts` now accepts the complete `MatchAction` and implements the
  `MatchTransition` contract, retaining shared due-deadline normalization.
- Thirty-nine tests in `advancement.test.ts` cover permissions, expiry, stable
  results, repeated advance, rounds 1–10, successful carry-forward with real T10,
  exhausted bidders, deferred/retry and controlled unavailable results, no
  eleventh search, immutable inputs, and shared/all-zero winners. Earlier tests
  now use actual advancement and assert the completed reducer contract.
- All 189 match tests / 424 workspace tests, workspace TypeScript checks, web
  production build, and whitespace checks passed. README, architecture, task
  status, and plan updated. No dependency, board, engine, solver, UI, or network
  changes; no commit. T11.6's mixed complete-match verification remains pending.
