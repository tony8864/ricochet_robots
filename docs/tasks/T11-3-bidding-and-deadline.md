# T11.3 — Bidding, Deadline, and Demonstration Order

## Status and goal

Implemented on 2026-10-25 after T11.1–T11.2. T11.4 subsequently extends the reducer
with demonstrations; T11.5 completes advancement and final results. Full-match
verification is complete in T11.6. The evidence below records T11.3's original
scope and checks; its historical reducer subset is now part of the full API.

Implement the pure Thinking → Bidding → Demonstrating path, using supplied
authoritative time. Read the [parent task](T11-pure-match-state-machine.md),
[state design](T11-1-state-and-transition-design.md), product, and architecture
before changing code. This task does not implement interactive demonstrations.

## Required transitions

| State/action | Result |
| --- | --- |
| Thinking: first valid roster bid | Bidding with deadline `nowMs + 60_000` |
| Bidding before deadline: new player bids any positive safe integer | Accept without comparing against another player's bid |
| Bidding before deadline: player lowers own bid | Accept; preserve original priority and deadline |
| Bidding before deadline: identical own bid | No-op; preserve priority and deadline |
| Bidding: own raise, invalid bid, or unknown player | Reject |
| Bidding: valid supplied time reaches deadline | Demonstrating with frozen ordered queue and first fresh attempt |
| At/after deadline: new/revised bid | Reject the bid while retaining the due expiry transition |
| Early time check, or time check outside bidding | No-op; no thinking/demonstration timeout |

## Implementation steps

1. Add focused bid/deadline handlers in `packages/match`. Reuse state, action,
   context, result types, and rule constants. Keep the dispatcher small and
   phase-oriented rather than one growing function of unrelated conditions.
2. Validate supplied command/context shapes, roster membership, positive
   safe-integer bids, safe-integer timestamps, and safe deadline arithmetic.
   Identity/time are trusted context, never authority copied from player payloads.
3. Accept the first bid, establish one absolute deadline, and assign immutable
   first-acceptance order. Each distinct bidder gets one bid entry.
4. Implement reductions and identical-bid no-ops. Do not allow raises or bid
   withdrawal, impose an arbitrary smaller cap, or inspect solver solution length.
5. Add a shared pure deadline-normalization step. With valid context/command
   shape, apply due expiry before checking command permissions in the resulting
   phase. This step must later be reused by all action handlers, not just bids.
6. On expiry, sort final bids by value then original first-acceptance order;
   initialize `activeBidderIndex` to zero and create the first engine attempt
   from `round.startRobots`. Non-bidders are absent from the queue.
7. Connect existing internal preparation acceptance to the reducer/controller
   path as appropriate. Keep solver work in explicit preparation coordination.
   Export only implemented behavior; an incremental action subset is acceptable
   until later handlers complete the existing `MatchTransition` contract. Do not
   publish success stubs or pretend an unimplemented valid action is handled.
8. Document the usable API, rejection/no-op reasons, and expiry semantics. Extend
   exports/types only where the implemented flow needs them.

## Deadline and ordering details

Use no clock reads, `setTimeout`, intervals, networking, or sleeps. The controller
will eventually call the time-advance operation; incoming actions must also
enforce the absolute deadline so a missing/delayed callback cannot permit late bids.

First acceptance, not reduction time, decides tied final bids. An acceptance
sequence handles equal timestamps deterministically. Do not silently add a
different tie rule; AGENTS.md already resolves the older architecture wording.

A valid late bid may return a rejected outcome with a new Demonstrating state.
The caller always consumes the returned state. A repeated expiry check must not
restart the attempt or rebuild a progressed queue after bidding is already closed.

## Acceptance tests

- First accepted bid starts exactly one 60-second window. Invalid first bids do
  not start it; later bids and reductions cannot extend it.
- Another player's higher/equal/lower bid is allowed. Own raises and zero,
  negative, fractional, non-finite, or unsafe bids are rejected; equal own bids
  are no-op. No arbitrary cap is introduced below safe integer representation.
- Priority survives reductions, including equal supplied timestamps. Final
  order is by bid then original first acceptance; non-bidders never get a turn.
- Time immediately before, exactly at, and after expiry behaves correctly;
  late initial bids/revisions cannot enter the frozen queue even without an alarm.
- The first attempt starts with all four round-start positions and empty history;
  official positions, scores, used IDs, and completed-round count are unchanged.
- Repeated expiry and time checks outside bidding are harmless. No other phase
  acquires a timer, including after long simulated demonstration time.
- Wrong-phase/source/actor commands and malformed contexts fail clearly. Invalid
  deadline arithmetic cannot produce an infinite/unsafe deadline.
- Frozen inputs remain unchanged; results and queue ordering are deterministic.
- Include a real create → T10 preparation → thinking → bidding → demonstration
  entry test. Use supplied timestamps, not real waits or timing assertions.

## Scope and verification

No moves, undo/reset/give-up handlers, no-bid skip, point awards, match advancement,
UI countdown, alarms, or network authentication are added. Fresh-attempt creation
on expiry is the only demonstration initialization needed here.

Run focused match tests/type checks, then workspace tests/type checks, production
build, and whitespace checks. Update task/plan/README with actual results. Do not
mark the whole T11 complete, commit, or start T11.4 automatically.

## Implementation evidence

- `packages/match/src/transition.ts` exposes the pure `transitionMatch` entry point
  for the explicit `BiddingStageAction` subset. It routes bids, time checks, and
  controller-prepared results; later commands are not represented as implemented.
- `bidding.ts` handles first bids, new bidders, reductions, no-op resubmission,
  invalid/raised bids, and safe deadline arithmetic. `deadline.ts` holds shared
  expiry normalization and frozen queue/fresh attempt initialization. `results.ts`
  contains small state/outcome constructors used by the new handlers.
- Context validation uses trusted actor/host/time fields. Positive safe-integer
  bids have no additional gameplay cap; first-acceptance order survives reductions.
- Normalization precedes actor/phase/domain checks for supported well-shaped
  actions. Rejected late bids, unknown actors, and wrong-phase prepared results
  retain any due expiry. Invalid command/context shape fails before normalization.
- Fifty-seven new tests cover the implementation, including six players, equal
  timestamps, exact deadline boundaries, safe arithmetic, real T10 integration,
  immutable results, and preserving progressed demonstration history/queue index.
- The full `MatchTransition` contract remains the target for T11.4–T11.5; the
  reducer currently advertises only the smaller implemented input subset.

## Recorded verification (2026-10-25)

- Match package: 121 tests passed, including 57 new bidding/deadline tests;
  TypeScript checks passed, including incremental action-contract assertions.
- Workspace: all 356 tests, all type checks, web production build, and whitespace
  checks passed. Tests use supplied timestamps and contain no timing sleeps.
- Existing puzzles, engine, board data, applications, and T09/T10 measurements
  are unchanged. No dependency, UI, alarm, or live multiplayer feature was added.
- T11 remains incomplete; T11.4–T11.6 are pending. Nothing was committed.
