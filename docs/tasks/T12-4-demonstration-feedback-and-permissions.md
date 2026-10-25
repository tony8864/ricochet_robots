# T12.4 — Demonstration Feedback and Permissions Polish

## Status and goal

Pending after T12.3. Read the [parent](T12-local-bidding-and-match-ui.md), product,
and architecture. Polish the demonstration already integrated in T12.1; do not
rebuild its controller, movement functions, or UI from scratch.

## Scope

1. Clearly display active bidder, target, bid limit, current retained move count,
   and selected robot. Distinguish whose turn it is from the seat being viewed.
2. Active seat gets robot selection, D-pad, Undo, Reset, Give Up. Other seats,
   including an inactive host, watch the same board/attempt without interactive
   controls or selectable robots. Phase/actor guards remain in T11 as well.
3. Explain the bid limit without treating it as automatic failure. Undo/reset/
   Give Up remain available at the limit. Do not charge no-ops, disable needed
   corrections, or let a UI-derived success flag override model state.
4. Give Up transitions to the next bidder's fresh round-start attempt or Round
   Result as returned by T11. Clear/reconcile stale presentation state across
   bidder/round changes without altering official positions or queue order.
5. Preserve smooth robot movement, selected white ring, target symbols/outline,
   and reduced-motion support. Animations must not delay scoring, authorize a
   move, or fire round transitions. Do not reanimate unchanged robots on seat switch.
6. Keep status/error feedback readable and accessible. Preserve focus sensibly
   when phase/actor changes remove controls; avoid unrelated visual redesign.

## Likely files

Existing demonstration components, small view-selection helpers, focused styles,
and component/controller tests. No duplicate move history, scoring, target solver,
or independent UI turn state.

## Acceptance and verification

- Active/non-active/host seat switches show correct feedback and input permissions
  without resetting history, bid, positions, or active turn.
- A blocked move adds no history; reaching the bid cap permits undo/reset; only
  retained moves count. Demonstration has no countdown or timeout.
- Give Up after moving multiple robots restores every round-start position for
  the next bidder with empty history and their own bid. Watcher sees the same state.
- Colored and vortex success within bid shows the model's result, commits all
  robots, and awards once; controls cannot undo/re-score a completed round.
- Manual animation and reduced-motion checks plus focused web tests/type check/
  build are recorded. Keep >=44px touch targets and existing responsive behavior.

## Checkpoint and exclusions

Integrated demonstration is clear for both active player and watcher. Results
presentation/Continue belong to T12.5; no host override, disconnected-attempt
handling, new input scheme, networking, or broad layout changes. Do not commit or
implement another subtask automatically.
