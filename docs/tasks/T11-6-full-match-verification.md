# T11.6 — Full Match Integration and Verification

## Status and goal

Completed on 2026-10-25 after T11.1–T11.5. Read the [parent task](T11-pure-match-state-machine.md),
the five earlier subtask files, product, and architecture before changing code.

Verify the assembled pure state machine from creation to Finished. Earlier
subtasks already include focused correctness tests; this step adds cross-phase
and complete-match coverage and closes any demonstrated gaps.

## Implementation and verification steps

1. Review the implemented public API and every row in the T11.1 transition table.
   Map each valid transition and rejected-action category to focused or integration
   coverage. Add tests for missing meaningful cases rather than duplicating tests.
2. Build a deterministic simulated-player controller for tests: explicit seat IDs,
   supplied timestamps, target ordering, preparation budgets, and scripted actions.
   Keep it in test code; no UI, browser clocks, or real timers are needed.
3. Exercise create → real T10 preparation → thinking → bids/reductions → deadline
   → multiple demonstrations → round result → next preparation → match finish.
4. Include a complete ten-round scenario with successful rounds and no-point
   outcomes. Check the fixed board, unique revealed targets, correct scores/counts,
   rollback, and carry-forward after every transition, not only at the end.
5. Include equal highest scores and an all-zero shared win. Verify no eleventh
   target is selected and final state cannot be changed by later commands.
6. Exercise preparation deferral/unavailability between resolved rounds. Verify
   preservation of official state, no false reveal/round consumption, and explicit
   bounded retry. Do not invent or implement live recovery scheduling here.
7. Compare actual exports, model types, documented command/results, architecture,
   README examples, and task statuses. Resolve drift and report remaining runtime
   or multiplayer limitations honestly.

## Fixture and test requirements

- Use production transition functions. Controlled preparation fixtures may keep
  targeted state tests small, but at least one cross-phase path must invoke the
  real T10 selector and replay its verified proof through legal match commands.
- A test solution can be known in advance or obtained internally from T10 for
  fixture construction. Every selected fixture target must have a valid legal
  witness; do not fabricate solvability with arbitrary target/result objects.
- Fix candidate order and timestamps. A scripted sample match must not depend on
  random availability, wall-clock speed, background jobs, or search-time assertions.
- Test at least two players and a six-player boundary. Show own bid reduction,
  another player's higher bid, tied bid priority, and an active bidder giving up
  after moving multiple robots before a later bidder succeeds.
- Verify undo/reset and current-history counting, at-limit corrections, colored
  and wildcard completion, no-ops, under-bid success, and unchanged official
  positions until atomic success.
- At deadline boundaries include a rejected late bid whose returned state has
  correctly advanced. Repeated time checks must preserve a progressed attempt.
- Reject unauthorized/wrong-phase inputs and stale preparation. Include duplicate
  resolution/advance attempts without claiming general network retry deduplication.
- Frozen-input/deterministic replay assertions must cover sequences as well as
  single transitions. Preserve all four robot positions and roster/score identity
  relationships through successes, failures, and preparation retries.

## Completion criteria and checks

T11 is complete when the reviewed pure transition table, full reducer contract,
T10 integration, atomic round outcomes, and ten-round rules are implemented and
verified. Fix any discovered rule defect with a focused regression test; avoid
unrelated cleanup or speculative features during verification.

Run:

```powershell
pnpm --filter @robot-puzzle/match test
pnpm --filter @robot-puzzle/match typecheck
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Run both tests and type checking because compile-time contract assertions are
not verified by ordinary Vitest execution alone. Rerun solver/selection benchmarks
only if that code changes or a concrete performance concern justifies it; preserve
the historical T09/T10 evidence.

Record actual counts, checks, and any blocker. Mark all completed subtasks and
the parent T11 only after the criteria hold. Leave T12 pending and identify the
open live recovery, server-performance, network authorization, command-retry,
and reconnection work in the handoff.

A passing sample match does not prove every possible official position can
supply ten reachable unused targets. It establishes the specified pure behavior,
not live multiplayer readiness. Do not add screens, deploy, commit, or begin
another task automatically.

## Transition and rejection coverage audit

All test files below are in `packages/match/src`. This maps every T11.1 table
row and rejection category to focused coverage; the new full-flow tests check
their composition rather than duplicate each individual case.

| Reviewed operation / category | Coverage |
| --- | --- |
| Create valid match; invalid roster/board/identity | `create.test.ts`; full-flow two/six-player creation |
| Preparing: selected/current proof accepted and target revealed | `preparation.test.ts`; real T10 on all 10 rounds in `matchFlow.test.ts` |
| Preparing: deferred/unavailable; explicit retry | `preparation.test.ts` (including real exhaustive failure); `advancement.test.ts`; between-round full-flow failure/retry |
| First bid; new higher/equal/lower bid; own reduction/identical bid | `bidding.test.ts`; mixed full-flow bidding script |
| Exact/overdue expiry; original tie priority; fresh frozen queue | `bidding.test.ts`; rejected late bid closes mixed-match bidding |
| Legal move; blocked input; over-limit move; undo/reset/empty correction | `demonstration.test.ts`; at-limit mixed-match corrections |
| Active bidder succeeds at/below bid; colored/wildcard matching | `demonstration.test.ts` (all four wildcard robots); full-flow colored and vortex successes |
| Give-up with next bidder; restore all four / clear history | `demonstration.test.ts`; multi-robot mixed-match give-up before later success |
| Last bidder gives up; no point and unchanged positions | `demonstration.test.ts`; both complete matches |
| Current-host confirmed no-bid skip; wrong host/no confirmation | `advancement.test.ts`; full-flow host skips |
| Result after rounds 1–9 advances only to Preparing | `advancement.test.ts`; every full-flow round boundary |
| Tenth result advances to Finished; tied/all-zero winners | `advancement.test.ts`; both complete matches |
| Finished rejects gameplay/advance/preparation; no round 11 | `advancement.test.ts`; full-flow finish and preparation-count assertions |
| Harmless early/outside-bidding time checks; progressed attempt preserved | `bidding.test.ts`; mixed-match time checks |
| `invalid-command`, `invalid-context`, `invalid-bid`, `bid-increase`, `bidding-closed` | `bidding.test.ts`; invalid moves in `demonstration.test.ts`; invalid skip payloads in `advancement.test.ts` |
| `wrong-phase`, `unknown-player`, `not-host`, `confirmation-required`, `not-active-bidder`, `bid-limit` | `bidding.test.ts`, `demonstration.test.ts`, `advancement.test.ts`; mixed-match negative actions |
| `stale-preparation`, `invalid-preparation`, `match-finished`; duplicate resolution/advance | `preparation.test.ts`, `advancement.test.ts`; replay of old preparations and repeated completion/advance actions in full flow |
| Runtime exports, full reducer contract, readonly phase/count types | `model.test.ts`, prior type assertions, and exact runtime export list in `matchFlow.test.ts`; verified by TypeScript as well as Vitest |

## Completion evidence

- Added `matchFlow.test.ts` with three tests and a deterministic test-only
  controller. Inputs/states are frozen; invariants are checked after each action,
  including all four legal official positions, score/roster keys, phase-specific
  fields, used-target uniqueness, count consistency, and atomic point/position
  changes. No runtime controller, dependency, or gameplay rule was added.
- The real-selector six-player match has four successes (including a helper-robot
  solution and vortex), three host skips, and three exhausted-bidder rounds.
  It tests own reductions, higher bids, tied original priority, rejected late
  bidding, at-limit undo/reset, rollback, current-history counts, under-bid
  success, stale preparation (also after unchanged positions), and repeat actions.
  Maria and Alex finish tied at two points; the other four seats have zero.
- The two-player match verifies 10 distinct real-selected targets, alternates
  skips and exhausted bidders, never changes official robots, and finishes 0–0.
  Neither fixture prepares an eleventh target. The mixed script is replayed from
  creation with identical full action/outcome/state traces.
- A real zero-budget deferral and a controlled trusted unavailable result are
  exercised between rounds before an explicit successful bounded retry. The
  controlled unavailable fixture verifies lifecycle handling, not actual search
  exhaustion; `preparation.test.ts` separately covers real exhaustive failure.
- Reviewed API/exports, types, README, architecture, and task status. No production
  rule defect was found. The initial test run caught an incorrect vortex ID in
  the new fixture; it now reads the wildcard's actual catalog ID.
- Focused checks: 192 match tests and match TypeScript checks passed.
  Workspace: all 427 tests, all TypeScript checks, web production build, and
  tracked/untracked whitespace checks passed. No solver or selection changes;
  historical benchmarks were not rerun or modified.
- T11.1–T11.6 and parent T11 are complete. T12 remains pending. No UI, server,
  deployment, dependency, or commit was added by this verification task.

## Remaining integration limits

These sample matches do not prove universal ten-round target supply. Live
preparation recovery and player feedback still need an approved policy, with
server-runtime budgets measured on Cloudflare. Never reset robots, change the
board, reuse targets, or reveal an unverified target as a silent fallback.
Trusted internal action contexts are not network authentication. Runtime protocol
validation, authenticated seats/host context, command-ID retries/deduplication,
durable snapshots, server-owned scheduling, and mobile reconnection remain later
tasks. No multiplayer or browser/device readiness is claimed from pure tests.
