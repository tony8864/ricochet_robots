# T18.3 — Round Gameplay Browser Flow

Status: implemented; verification recorded below. Depends on T18.2.
Parent: [T18](T18-end-to-end-multiplayer-tests.md).

## Scope

- Exercise Thinking's read-only board, bid entry/submission, shared bidding
  timer and live roster. Lower an own bid; verify original first-bid tie priority
  and that a different player's higher bid is still allowed.
- Close bidding using only the reviewed server-clock harness or actual deadline.
  Verify both clients agree on the active bidder and spectator controls.
- Use normal robot selection/D-pad to exercise accepted movement, a no-op,
  Undo and Reset, comparing rendered positions/counts on both clients.
- Give Up after movement; verify all four robots roll back for the next bidder.
  Complete a checked deterministic route through the actual UI; verify success
  within the bid, one point and all-four carry-forward after host Continue.
- Guest waits in the round-result modal; host Continue advances both. Verify
  confirmation cancellation for Thinking-only Skip Round without changing rules.

## Acceptance and checks

Browser evidence covers at least a failed attempt followed by successful completion
and the next round's actual starting positions. Known routes are private test
fixtures validated against real board/rules, not hints or exposed solver proofs.
Never patch scores/history or accept fabricated preparation. Run targeted browser
tests and relevant type/regression checks. Keep this checkpoint to round flow;
T18.4 adds ten-round completion.

## Timing and route decision

Use real production time and the actual 60-second server bidding window in this
checkpoint. The browser waits for the authoritative Demonstration heading with a
bounded timeout, not a fixed sleep or browser-clock modification. The test checks
the accepted deadline remains unchanged by revisions and does not advance early.
There is no new server clock, debug route, fixture Worker, target override or
change to production durations. The round case naturally takes about a minute;
T18.4 must separately review timing for a ten-round browser run.

The real catalog/selector chooses the board and target. A deterministic private
Node helper derives and replay-checks a UI route for that actual public state.
It uses the existing solver per-candidate/total expansion policy. Two safe moves
on different robots support corrections/failure checks; the checked winning route
leaves at least two robots displaced so all-four carry-forward is meaningful.
An inconclusive preparation or bounded private route search fails with board/target
context rather than injecting state, claiming solvability or increasing budgets.
Proofs/routes are never sent to the browser as data, exposed through an API or
attached to output. Only ordinary player clicks enter the real game.

## Browser evidence

`apps/e2e/tests/round.spec.ts`, with helpers in `support/gameplay.ts`, drives:

- UI Create/Join/Start and the real verified Thinking reveal; read-only robots
  and no movement controls before demonstration.
- Native Skip Round confirmation cancellation without consuming a round.
- First bid/deadline, a different player's higher accepted bid, own-bid lowering,
  live roster reorder, equal-final-bid priority by original first acceptance and
  blocked own-bid increases. Both clients receive the same deadline/countdown.
- Actual server-driven bidding expiry; correct active bidder/spectator UI.
- D-pad selection/movement, repeated blocked direction as a no-op, unchanged
  attempt version/count, Undo, two-robot Reset, then two-robot Give Up rollback.
  Both rendered boards/counts are checked, and scores/official positions stay put.
- Second bidder's checked solution below the bid, identical success dialogs and
  one point. The guest waits; only host Continue advances to verified Thinking in
  round two, with a different target, unchanged board and all four final positions.

No application, shared rule, schema, dependency or harness-security change was
needed. This is rendered Chromium evidence for one completed round plus the next
reveal, not a ten-round or physical-device/Safari pass. T18.4 remains pending.

## Verification notes

The targeted round run passed, followed by all six browser cases with strengthened
no-op/version and live-reorder assertions. Workspace type checks, final E2E type
check, ordinary production build and whitespace checks passed. Runner/browser
versions are unchanged from T18.1.

An initial `pnpm test` run overlapping browser work timed out in the existing
six-player ten-round server test at its unchanged 60-second timeout (249/250
Workers assertions passed; the separate full-runtime suite was not reached).
This was not an assertion mismatch. Resource contention is a possibility, not a
confirmed cause. A full rerun was started after browser teardown; no timeout,
budget or test assertion was weakened to make it pass.

The final standalone `pnpm test` rerun passed all 1,530 existing tests, including
all 250 Workers tests and 30 separate full-runtime tests. Browser coverage remains
six separate cases (6/6 passed), not included in that count. Known Worker shutdown/
Windows temporary-cleanup warnings remain. Initial timeout evidence is retained;
the passing rerun does not certify its cause or eliminate the reliability risk.
Nothing committed or deployed; stop before T18.4.
