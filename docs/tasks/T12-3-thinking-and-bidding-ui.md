# T12.3 — Thinking, Bidding, Countdown, and No-bid Skip

## Status and goal

Pending after T12.2. Read the [parent](T12-local-bidding-and-match-ui.md), product,
architecture, and T11 bid/deadline API. Make verified rounds playable from Thinking
through bid expiry without exposing interactive robot simulation.

## Scope

1. Add the bid panel below the board: positive-integer input and **Submit Bid**.
   Show round/target, acting player, and their accepted bid. Hide robot selectors,
   D-pad, and attempt actions in both Thinking and Bidding; disable board selection.
2. The first accepted bid changes to Bidding. Extend the same panel with a
   countdown and readable list of every player's accepted bid. Let any seated
   player bid regardless of others, or lower their own existing bid, never raise.
   Do not invent a cap below the model's positive safe-integer representation.
3. Keep draft input presentation-only and keyed/reset appropriately when changing
   acting seat/round. Clearly distinguish unsent drafts from accepted bids and
   display rejected-command feedback without accepting a locally guessed update.
4. Derive countdown from the model's absolute deadline and local supplied time.
   Schedule a local `time.advance` request at expiry and normalize on browser
   resume/visibility restoration and before incoming actions. Never rely on a
   decrementing counter or rounded display to decide acceptance. Clean up timers.
5. Keep the clock injectable; use controlled time in tests and, if useful, clearly
   separated development time controls. These must advance the supplied clock/
   model normally, not directly mutate phase. Label all of this as local simulation.
6. Add host-only **Skip Round** in Thinking with explicit confirmation. Cancellation
   changes nothing; confirmation sends `round.skip`. Remove the action as soon as
   a bid is accepted. Do not introduce host skipping of active demonstrations.
7. When T11 returns Demonstrating, show T12.1's existing integrated controls.
   Always consume state returned with late/rejected commands; never reopen bidding.

## Likely files

Bid panel, local clock/controller adapter, `App.tsx` phase composition, focused
styles, and controller/UI tests. Reuse the existing match reducer unchanged unless
an actual defect is demonstrated with a regression test.

## Acceptance and verification

- Submit bids as two different seats, including a higher bid; lower one player's
  own bid, reject a raise, and preserve original priority/deadline across edits.
- Invalid/empty/fractional/nonpositive input cannot start bidding or create an
  accepted bid. Switching seats cannot submit under the previous player's identity.
- Test just before, exactly at, and after the deadline with supplied time. A late
  bid is rejected while returned state correctly becomes Demonstrating.
- Background/resume past expiry advances once; repeated timer callbacks preserve
  a progressed attempt. No timers exist for Thinking or Demonstration.
- Board is read-only and movement controls absent in both phases. Host confirmation
  is required for skip; non-host/cancel/skip-after-first-bid cannot consume a round.
- Run focused web/match tests and web type check/build. Exercise bidding and
  timer/visibility behavior in a browser; record real results and limitations.

## Checkpoint and exclusions

Setup -> Thinking -> Bidding -> Demonstrating works with player switching.
Skip/result may still use the minimal result placeholder until T12.5. No server
deadline authority, WebSockets, reconnection, sounds, hints, automatic bids, or
new gameplay rules. Do not start the next subtask or commit automatically.
