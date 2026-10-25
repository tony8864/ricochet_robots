# T12.6 — Full-flow and Mobile Verification

## Status and goal

Pending after T12.1–T12.5. Read the [parent](T12-local-bidding-and-match-ui.md), the
five subtask files, product, and architecture. Verify the assembled local UI;
earlier subtasks already require their own focused correctness tests.

## Scope

1. Audit setup, controller, phase panels, match state ownership, and player
   permissions against the agreed plan. Correct demonstrated defects with
   regression tests; avoid speculative refactors or new gameplay rules.
2. Exercise a complete local ten-round match through UI/controller integration,
   using fixed roster/order and controlled time in automated tests. Include at
   least two players and six-player boundary coverage, host vs normal player,
   changing Act as, own reductions, higher competing bids, and tied priority.
3. Cover active/read-only demonstrations, undo/reset/no-ops, corrections at the
   limit, multi-robot Give Up rollback, later-bidder success, carry-forward,
   no-bid skip, exhausted bidders, round continuation, and shared/all-zero results.
   Use valid engine-backed witnesses privately in tests, never player-facing hints.
4. Include real T10 preparation in a cross-phase path and failure/retry coverage.
   Target non-repetition, board locking, all four official positions, and ten-round
   finish must hold. UI failures must not fake a target, reset robots, or loop.
5. Test deadline boundaries and browser visibility/resume. A late bid's returned
   state must retain expiry; repeated callbacks/StrictMode cannot restart attempts,
   duplicate accepted actions, or create extra rounds. No real-time test sleeps.
6. Verify small portrait phones, the established compact-height layout, tablet
   portrait, and desktop. Keep board square, controls below it, existing narrow
   horizontal spacing, minimum 44px targets, legible target/phase/bid/status, and
   usable bid input when the on-screen keyboard is open. Do not impose a new
   universal no-scroll rule or reintroduce the rejected board/controls two-column
   layout. Make only scoped fixes for demonstrated regressions.
7. Check keyboard/focus/labels, reduced-motion and normal movement animation,
   confirmation behavior, watcher read-only controls, and no active target before
   selection. Keep local developer controls separate and clearly labeled.

## Checks and evidence

Run focused web/match tests, then:

```powershell
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Use existing tooling first; justify new browser-test dependencies before adding
them. Record actual automated counts, browser interactions, viewport dimensions,
and device/browser versions where available. Desktop emulation is not a real
iPhone Safari check; report any unavailable device/browser verification honestly.
Do not rerun solver benchmarks unless solver/selection behavior changes or a
specific measured concern warrants it; preserve historical results.

Update parent/subtask statuses, plan, and local development instructions, including
how to act as each player and control test time. Check that no standalone demo
state remains authoritative and no solver proof is exposed by the UI.

## Completion and exclusions

T12 is complete only when the single-tab simulated group can play the full match
with correct phase controls and documented verification/limitations. A passing
fixture does not prove ten-target supply from every future position or server
runtime suitability. Keep live recovery policy, authenticated networking,
server-authoritative deadlines, command retries, durability, and reconnection
explicitly pending. No deployment, commit, T13 implementation, or silent scope
expansion is authorized.
