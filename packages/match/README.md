# Pure match model

`@robot-puzzle/match` owns the match lifecycle shared by the later local prototype
and authoritative server. T11.1 adds its TypeScript contracts and rule constants;
T11.2 implements validated creation and explicit verified round preparation;
T11.3 implements bids, deadline expiry, and first-demonstration entry through an
incremental reducer. T11.4 adds active-bidder attempts, rollback, and atomic
success/exhausted-bidder resolution. T11.5 completes no-bid skip, explicit round
advancement, ten-round termination, and derived shared-winner results. T11.6
verifies the assembled lifecycle with full scripted matches. T11 is complete
for the pure model; UI and authoritative multiplayer remain later tasks.

```ts
import type { MatchState, MatchAction, MatchTransitionResult } from '@robot-puzzle/match';
```

## Create a match and prepare a round

```ts
import { createMatch, prepareMatchRound } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';

const preparing = createMatch({
  matchId: 'match-1',
  players: [
    { seatId: 'maria', nickname: 'Maria' },
    { seatId: 'alex', nickname: 'Alex' },
  ],
  puzzle: starterBoard,
});

const result = prepareMatchRound(preparing, {
  // Fixed order for this example; the later controller supplies shuffled IDs.
  candidateOrder: starterBoard.targets.map((target) => target.id),
  budget: RECOMMENDED_ROUND_SETUP_BUDGET,
});

const state = result.state;
if (state.phase === 'thinking') {
  // Round 1 is revealed. state.round contains target and startRobots.
} else if (state.phase === 'preparing') {
  // Read state.preparation for a deferred/unavailable reason; no round consumed.
}
```

`createMatch` validates a nonempty match ID, 2–6 distinct nonempty seat IDs,
nonempty nicknames, and full catalog geometry/targets/initial positions. Duplicate
nicknames are allowed; seats identify players. It copies known data fields into
owned state, initializes zero scores, and returns Preparing without selecting a
target. Invalid creation input throws `TypeError`. No host, credentials, or timer
is stored, and no IDs or randomness are generated.

`prepareMatchRound` is a trusted controller operation. It rejects non-Preparing
phases (including Finished) without running the solver. For valid Preparing state,
it captures match ID, completed-round count, locked board data, current positions,
used IDs, candidate order, and budgets. It calls the real T10 selector exactly once.
T10 validates ordering/limits; malformed options throw `TypeError` or `RangeError`.

The internal acceptance handler rejects stale requests, wrong-board/foreign/used
or already-complete targets, incorrect start positions, and invalid proofs. It
replays successful proofs through the engine before revealing anything. New
round data and the used target ID are recorded together; completed rounds,
scores, official positions, and the fixed roster/board remain unchanged. All
four current positions are copied into `round.startRobots`. Solver-final positions
are never committed by preparation.

On deferred/unavailable selection, the operation itself is accepted but the match
remains Preparing with the copied reason/diagnostics. There is no active target,
used-ID change, score change, or consumed round. The caller may explicitly call
again with an appropriate bounded policy; no retry or recovery job is scheduled.

The internal snapshot/acceptance functions and controlled-preparer test seam are
not exported by the package. T11.3 connects acceptance to the reducer's internal
`round.prepared` controller command, without running the selector inside the
reducer. Creation/preparation remain available as the public functions above.
`PlayerMatchCommand` has no prepared-target command;
these functions assume trusted controller use and do not authenticate callers.
The future server owns that network/authentication boundary.

## Bid and advance the deadline (T11.3)

```ts
import { transitionMatch } from '@robot-puzzle/match';

if (state.phase === 'thinking') {
  const firstBid = transitionMatch(state, {
    source: 'player',
    command: { type: 'bid.submit', value: 7 },
    context: { actorSeatId: 'maria', hostSeatId: 'maria', nowMs: 1_000 },
  });

  // The controller supplies time; the model never starts an interval itself.
  const expired = transitionMatch(firstBid.state, {
    source: 'controller',
    command: { type: 'time.advance' },
    context: { nowMs: 61_000 },
  });
  // expired.state is Demonstrating, with a frozen queue and fresh attempt.
}
```

The `BiddingStageAction` subset introduced by T11.3 is:

- Player: `bid.submit`, with trusted actor, current host, and time context.
- Controller: `time.advance`, or `round.prepared` with its internal request/result.

T11.4's `DemonstrationStageAction` adds player `attempt.move`, `attempt.undo`,
`attempt.reset`, and `attempt.giveUp`. T11.5 completes the reducer's full
`MatchAction`/`MatchTransition` contract with player `round.skip` and controller
`round.advance`. The historical subsets remain exported for narrower callers.
Unknown/incorrect-source commands passed despite the TypeScript contract return
`invalid-command` rather than fake success.

The small entry point delegates to `bidding.ts`, shared deadline normalization
in `deadline.ts`, `demonstration.ts`, and T11.2's preparation acceptance handler. It reads no clock,
shuffles no targets, and performs no solver search. Tests use supplied time.

First accepted bid creates `deadlineAtMs = nowMs + 60_000`. Any roster player may
bid any positive safe integer regardless of other players' bids. A player can
lower their own bid, not raise it; an identical own bid is a no-op. No update
extends the deadline or changes that player's `firstAcceptedOrder`.

At or after the deadline, the reducer freezes final bids ordered by value then
original first acceptance, creates the first attempt with all round-start
positions and empty history, and drops bidding-only fields. Non-bidders are not
queued. Expiry changes no score, official position, used target, or round count.

Runtime processing is: recognize the supported source/command shape, validate
trusted context, normalize due expiry, then check actor membership and domain
rules. Player context requires nonempty actor identity and a current host present
in the fixed roster. All timestamps must be nonnegative safe integer milliseconds;
first-bid deadline arithmetic must also remain safe. Context authority is supplied
by the future server, not inferred from payload fields. No backward-time policy
or new gameplay bid ceiling is introduced by this task.

Always use `result.state`, even for rejected actions. A late bid returns
`bidding-closed` with the state already Demonstrating, without accepting that bid.
An unknown actor can similarly receive `unknown-player` after due expiry. A
recognized late bid with an invalid value is still rejected as closed. Malformed
or unsupported commands/contexts fail before deadline normalization.

An early time check is `deadline-not-due`; outside bidding it is
`no-active-deadline`. A repeated check cannot restart an attempt or reset the
active queue index. Thinking and demonstrations never acquire timers.

## Demonstrate and resolve a round (T11.4)

```ts
const moved = transitionMatch(demonstratingState, {
  source: 'player',
  command: { type: 'attempt.move', robotId: 'blue', direction: 'down' },
  context: { actorSeatId: 'maria', hostSeatId: 'maria', nowMs: 62_000 },
});
```

Only the seat at `bidderQueue[activeBidderIndex]` can control the attempt. The
current host has no special override. Movement, counting, undo, reset, and target
completion reuse engine functions. A blocked direction is free even at the bid
limit; an extra non-no-op move is rejected as `bid-limit`, leaving undo/reset/
give-up available. Undo and reset discard history freely, so only retained moves
count. The active bidder can move any robot, including helpers.

On valid completion within the bid, `completion.ts` atomically enters Round Result,
awards one point, commits copied final positions of all four robots, records the
success outcome, and resolves the round once. Round-start positions and used IDs
remain unchanged; attempts/queues/deadlines are not carried into result state.
Subsequent attempt commands are rejected, so success cannot be undone or scored
again. Round-result advancement does not award that point a second time.

Give-up discards all provisional movement and history. If another bidder remains,
they receive a fresh attempt from the same four round-start positions with their
own final bid. When no bidders remain, Round Result records no scorer, preserves
official positions/scores, and consumes the round once. Invalid commands never
count as give-up. There is no demonstration timer or automatic next-round search.

Valid late attempt commands use the same due-expiry normalization as bids: close
bidding first, then check the actor against the new active bidder. Invalid robot
IDs/directions or command/source shapes fail before normalization. General network
retry deduplication and abandoned/disconnected bidder handling remain server work.

## Skip, advance, and finish (T11.5)

```ts
const skipped = transitionMatch(thinkingState, {
  source: 'player', command: { type: 'round.skip', confirmed: true },
  context: { actorSeatId: 'maria', hostSeatId: 'maria', nowMs: 1_000 },
});
const advanced = transitionMatch(skipped.state, {
  source: 'controller', command: { type: 'round.advance' },
  context: { nowMs: 1_000 },
});
// Rounds 1–9: advanced.state is Preparing; call prepareMatchRound explicitly.
// Round 10: advanced.state is Finished; no eleventh target selection is run.
```

Only the current host supplied by trusted context may skip, only in Thinking,
and only with `confirmed: true`. A non-host receives `not-host`; the host without
confirmation receives `confirmation-required`. Missing/nonboolean confirmation
is `invalid-command`. Skip is `wrong-phase` after bidding begins; at expiry the
returned state still retains the independently due Demonstrating transition.
The host cannot bypass an active bidder. Skip reuses atomic completion, keeps
scores/all four official positions unchanged, and consumes the revealed round
once without adding another used target ID.

Round Result stays stable until trusted `round.advance`. Advance preserves scores,
official positions, used IDs, roster, and board; it removes old round/result data.
Before ten completed rounds it enters Preparing with `not-attempted` status.
Preparation is separate: deferred/unavailable results consume no round, and
explicit retries retain all committed data. After round ten it enters Finished
directly. Advance elsewhere is `wrong-phase`, or `match-finished` after finish;
repeating it cannot resolve or score a round twice. Player gameplay commands
after finish are also `match-finished`; harmless time checks remain no-ops.

`getMatchResults(finishedState)` returns `{ standings, winnerSeatIds }`, derived
from final roster/scores without storing a second score copy. Each standing has
`seatId`, `nickname`, and `score`. Standings are descending by score with stable
roster order for tied display rows; every highest-scoring seat wins, including
every player in an all-zero match. The selector requires Finished (and throws
`TypeError` for a non-Finished value supplied outside its type contract).

Continue-button policy, confirmation UI, rematch, authenticated host transfer,
command deduplication, and live preparation recovery remain later work.

## State and transition contracts

The six-state discriminated union separates phase-specific data:

| Phase | Additional data |
| --- | --- |
| `preparing` | Not-attempted, deferred, or unavailable preparation status |
| `thinking` | Active round: number, target, and start positions |
| `bidding` | Active round, nonempty bids, absolute deadline |
| `demonstrating` | Active round, nonempty frozen bidder queue, active index, engine attempt |
| `round-result` | Resolved round and success/give-up/skip outcome |
| `finished` | Ten completed rounds; results derived from roster and scores |

Every phase shares match ID, fixed roster, scores, locked puzzle, official robot
positions, used target IDs, and completed-round count. Official positions commit
on success; round start is an immutable snapshot; the engine attempt holds only
provisional positions. Bid limit and active seat come from the active queue entry;
move count comes from engine history. Avoid independently editable duplicates.

Player commands carry no identity or clock authority. `MatchAction` separates
player commands plus trusted actor/host/time context from controller commands
(time check, round advance, internally prepared T10 result). A preparation request
binds match ID and completed-round count to the complete T10 input, including
board, official positions, and used targets. Preparation proofs may travel through
this internal request/result path, but are not fields in ordinary match state.

The reducer contract is `(state, action) => { state, outcome }`, with
accepted/no-op/rejected outcomes. Always consume its returned state: an overdue
bidding deadline can advance the phase even when the accompanying late bid is
rejected. `transitionMatch` implements the full `MatchTransition` contract;
T11.2's preparation functions return the same state/outcome shape.

All fields are readonly TypeScript contracts; they do not freeze objects or
validate network messages. T11.2 validates creation and preparation inputs and
owns copies of caller data. T11.3 validates bid/time/context data and derives the
initial ordered queue. Existing valid match state is trusted internal state, not
a deserialization boundary. T11.4 checks attempt phase/actor/limit and performs
queue progression and atomic resolution. T11.5 adds skip/advance permissions and
final results. The server
will validate and authenticate untrusted input and restored state before using
these internal operations.

`model.test.ts` verifies the public contract using runtime constant/import checks
and compile-time assertions. Run both tests and type checking: Vitest execution
alone does not validate `expectTypeOf` assertions. `create.test.ts` and
`preparation.test.ts` test creation, actual Preparing → Thinking transitions on
all five boards, failed preparation, immutable snapshots, and stale/invalid result
rejection. `bidding.test.ts` covers bids, reductions, safe timestamps, deadline
boundaries, priority, wrong-source/actor checks, no timers outside bidding, frozen
inputs, and the real create → T10 → bids → demonstration-entry path.
`demonstration.test.ts` covers movement/correction/limits, all four vortex robots,
colored matching, multi-robot rollback and carry-forward, later-bidder success,
cumulative scoring, stale commands, and immutable replay. `advancement.test.ts`
covers confirmed/current-host skip, wrong phases, round-result stability, all
advance boundaries, real carry-forward preparation, failure/retry, termination,
shared winners, and frozen inputs. `matchFlow.test.ts` adds a test-only controller
that checks phase fields, valid positions, counts, used IDs, fixed board/roster,
score changes, and all four official positions after every action. Its six-player
mixed match runs twice with identical complete state/action/outcome traces and
ends in a 2–2 shared win. Its two-player no-point match ends in a 0–0 shared win.
All ten targets in each fixture are verified by real T10 from current positions;
internal witnesses are replayed as legal demonstration commands. Real deferral
and controlled unavailability exercise explicit retry without a false reveal.
The T11.6 task contains the transition/rejection coverage audit.

Passing these fixtures does not prove ten reachable unused targets exist from
every possible future position. Live recovery policy/scheduling, Cloudflare
runtime performance, authenticated protocol validation, command IDs/retry safety,
durability, and reconnection remain integration work. Test-side frozen snapshots
are not a substitute for validating restored or untrusted network state.

```powershell
pnpm --filter @robot-puzzle/match test
pnpm --filter @robot-puzzle/match typecheck
```

Dependency direction is match -> puzzles/game-engine; puzzles -> game-engine.
Neither lower-level package imports match. Model/command dependencies are type
imports; preparation imports the T10 selector but runs it only on an explicit
call, not on package import or creation. No React,
Cloudflare, networking, timer, randomness, persistence, or state library is used.

The full reviewed state/transition table is in
`docs/tasks/T11-1-state-and-transition-design.md`.
