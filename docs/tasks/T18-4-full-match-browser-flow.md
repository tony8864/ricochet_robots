# T18.4 — Full-Match Browser Flow

Status: implemented and verified (2026-11-02).
Depends on T18.3.
Parent: [T18](T18-end-to-end-multiplayer-tests.md).

## Scope

- Extend the real two-context UI flow from entry through all ten rounds. Include
  successful carry-forward and an unsuccessful/skipped round; do not call a
  shortened match or ten skipped rounds proof of the complete gameplay path.
- Drive real preparation/bidding/demonstration/result/Continue actions. Keep
  bounded validator budgets and production rules; control time/selection only
  through the separately reviewed test harness.
- Assert same target, board, official positions and score after each round;
  final standings agree, no round 11 appears, host sees New Match and guest waits.
- Refresh both final-results views, then host New Match returns both to the same
  lobby with original room code/host/seats. Explicit Start creates a fresh match
  with clean scores and catalog starting positions.
- Add a focused six-context scenario for roster/bids/shared state if not already
  covered at the browser layer. Keep positive ties/no-winner rule permutations in
  existing tests unless a distinct rendered-browser gap justifies another match.

## Acceptance and checks

A reproducible browser command completes a ten-round multiplayer game and rematch
entry, with failure diagnostics identifying the round/phase/action. No gameplay
state injection, exposed proofs, arbitrary waits or solver-budget escalation.
Run browser cases and relevant regressions/types/build. Explicitly distinguish
six isolated browser identities from six physical participants/devices.

## Timing decision and implementation

Keep production time/rules and the actual server-owned 60-second bidding windows.
`apps/e2e/tests/full-match.spec.ts` adds two cases, without a fixture Worker,
clock endpoint, entropy override, accepted-state injection or dependency change.

The complete two-browser case follows all ten rounds through normal UI actions:

- Round 1: two accepted bids, actual deadline, host movement/Undo and a two-robot
  failed attempt, then the guest's privately checked solution and one point.
- Round 2: actual deadline, movement and all bidders giving up; no point and all
  four robots roll back to the carry-forward positions established in round 1.
- Rounds 3–10: verified target reveal, normal confirmed host Skip Round and result
  advancement. All ten targets must be distinct; board, starting positions,
  official positions, scores, host, seats and matching client state are checked.

This is a mixed-outcome ten-round game, not a shortened match or ten skips. It
does not claim ten successful demonstrations. Two real bidding windows make the
case take roughly two minutes plus actions/preparation; condition waits, not
fixed sleeps, wait for the actual server transitions. Preparation and route
verification retain existing budgets and report a block rather than bypass it.

Both clients must display the same final standings and ten completed rounds.
The host alone sees New Match; both clients refresh into the same Finished state.
New Match returns everyone to the original room/code/seats/host and a fresh lobby
ID. Explicit Start must create a different match ID with clean scores, round 1,
fresh used-target tracking and catalog initial robot positions.

The six-context case independently creates six cookie identities through the
UI, verifies the complete roster and board, submits/revises bids and compares
all clients' shared match/deadline/bid state and sorted roster. It does not wait
for a third deadline or pretend six contexts are six physical devices.

Named Playwright steps identify the failing round/outcome/deadline or final/
rematch stage. Existing private-artifact and isolated-runtime rules still apply.
Only test/documentation changes are intended; T18.5 remains a separate request.

## Verification evidence

Targeted `pnpm --filter @robot-puzzle/e2e test:e2e tests/full-match.spec.ts`
passed both cases: mixed ten-round match/rematch (about 2.2 minutes) and six
independent identities (about five seconds). Workspace type checks and ordinary
production build passed. Full `pnpm test:e2e` then passed all eight cases (about
3.5 minutes), including a second complete mixed match and a second six-context
pass. The runtimes shut down and no owned temporary directory remained afterward.
Known Miniflare alarm-cancellation and Node color-environment warnings did not
fail the browser run. Final workspace regression results follow below.
No rule, solver budget, match length or server deadline was shortened. No browser
pass implies physical-device coverage, a process restart inside this script,
ten successful rounds or arbitrary carry-forward solvability. Existing T17/T18
device/resource limits remain open. Runner environment is unchanged from T18.1.

Final standalone `pnpm test` passed all 1,530 existing tests, including 250 Workers
and 30 separate full-runtime tests. No browser run overlapped this regression
command. Workspace types, production build and whitespace checks passed. No test
timeout, rule or search budget was changed; known Worker shutdown/Windows cleanup
warnings remain. The targeted pair and all eight browser cases passed on fresh
runtimes. Only `tests/full-match.spec.ts` and documentation changed in this
checkpoint; existing work was preserved. Nothing committed/deployed. T18.5 remains
pending and no physical-device/full-six-player-match claim is made.
