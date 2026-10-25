# T12.5 — Round Results, Continuation, and Final Standings

## Status and goal

Pending after T12.4. Read the [parent](T12-local-bidding-and-match-ui.md), product,
architecture, and T11 completion/results API. Finish the user-visible local loop.

## Scope

1. Replace result placeholders with distinct success, all-bidders-gave-up, and
   no-bid-skip feedback. Show winner/bid/move count only for success and show
   current scores. Use the completed model outcome, never recompute/award points.
2. Add **Continue** to invoke the trusted local controller's `round.advance`.
   This is local orchestration, not a new player command or a decision about
   future multiplayer Continue permissions. Switching seats does not auto-advance.
3. After rounds 1–9, explicitly prepare the next round from the current locked
   board, all official robots, used IDs, and normal bounded options. Reflect
   Preparing/success/failure using the existing controller/preparation panel.
4. Keep results stable until Continue. Guard repeated clicks/stale handlers so
   they cannot advance two results, award twice, or trigger repeated searches.
   Preparation failure reveals no new target and consumes no round; retry remains
   an explicit bounded local controller action.
5. After round 10, render Finished with `getMatchResults`: descending scores,
   every tied highest seat marked winner, and sensible all-zero shared-win text.
   No eleventh preparation, bidding, movement, or Continue-to-another-round action.
6. Keep all four official final positions visible as appropriate and all target
   artwork intact. Never substitute solver-final positions or catalog starts.

## Likely files

Round-result and final-standings panels, local orchestration/phase composition,
focused styles, and controller/UI tests. No match scoring rewrite is expected.

## Acceptance and verification

- Each outcome has correct text/scores; no-point outcomes show no invented winner.
- Multi-robot success -> Continue -> real preparation preserves every final robot
  and excludes used targets. Exhaustion/skip preserve official positions unchanged.
- Repeated Continue and late attempt actions cannot double-score/skip/consume.
- Deferred/unavailable next preparation displays a clear no-new-target state;
  explicit retry preserves scores/counts/used IDs/positions.
- Round 10 leads directly to final standings; ties and all-zero results show all
  leaders. Further gameplay cannot change the finished state.
- Run relevant web/match tests and web type check/build; browser-check one normal
  result, a no-point result, preparation feedback, and final standings.

## Checkpoint and exclusions

The full local ten-round loop is available for T12.6 verification. No rematch,
automatic result timeout, lobby return/reset policy, persistence, multiplayer
Continue authorization, deployment, or subsequent task implementation. Do not
commit automatically.
