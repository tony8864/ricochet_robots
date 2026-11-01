# T16.2 — Connected Demonstration Controls

## Status and purpose

Complete: automated verification passed and the owner confirmed the PC/phone checklist.
Follows [T16.1](T16-1-authoritative-attempts-and-round-outcomes.md).
First interactive demonstration checkpoint in [T16](T16-synchronized-demonstration-and-scoring.md).

## Scope

1. Reuse the established selector, D-pad, action buttons, target and move/bid
   presentation. Show enabled controls only for the bound active bidder during
   Demonstrating. Spectators see the same board/turn/count but cannot simulate.
2. Keep robot selection local and immediate. Directional requests capture the
   selected robot/direction plus the latest attempt context at send time.
3. Extend the existing single pending-room-mutation adapter. Do not queue rapid
   taps or predict positions. Disable movement/Undo/Reset/Give Up while an action
   is unresolved; selection may remain local. Do not wait for every animation to
   finish before considering a reconciled command resolved.
4. Reconcile private outcomes with public snapshots/revisions before allowing a
   new mutation. A timeout/disconnect exposes an exact retry of the immutable
   original request, including after success or bidder change. Never regenerate
   its ID/payload to replay an uncertain move/Give Up against newer state.
5. Give Up sends immediately, with **no confirmation**. Reset also gets no new
   confirmation. Show safe inline rejection/pending/connection feedback. Host
   status alone grants no attempt controls or skip-demonstrator action.
6. Animate ordinary confirmed movement for active player and spectators. The
   owner subsequently approved Reset animating all robots directly and
   simultaneously to round start, not replaying moves one by one. No extra wire
   metadata is needed. Snap on bidder change and rebind/reconnect, or when snapshots
   skip intermediate attempt versions. Do not infer fictitious paths or use CSS
   animation events to advance game state. Respect reduced-motion settings.
7. Keep positions/move count/turn derived from snapshots; do not run the local
   controller, solver, engine simulation or scoring in this connected view.
   Preserve Thinking/Bidding read-only behavior and the local simulator separately.
8. If an action ends the round, show an honest read-only interim result status
   from its snapshot until T16.3 connects the full result modal. Do not invent a
   Continue action or leave active movement controls on a completed attempt.

## Likely files and checks

- Connected room adapter, `ConnectedLobby`, existing demonstration presentation,
  tests and minimal scoped animation support. Preserve geometry, SVG artwork and
  general responsive rules; no UI framework or redesign.
- Tests: active/spectator/disconnected controls, selection during pending action,
  captured payload, rapid duplicate taps, no-op feedback, over-limit corrections,
  exact retries, rejected actions, snapshots before/after acknowledgments, old
  socket events, bidder/phase changes and local simulation absence.
- Animation tests distinguish accepted moves from restoration/rebind and verify
  cleanup/reduced motion. Record visual checks separately from markup/unit tests.
- Relevant web/shared tests, type checks, production build and whitespace checks.

## Owner checkpoint and stop

PC/phone share one attempt: active bidder moves/corrects/gives up, spectators
observe matching positions/count and cannot control. Reset animates directly to
round start; bidder change/reconnect snap. Record actually observed latency/phone readability.
Stop before full result progression or T17 automatic recovery.

## Implementation record

- `liveLobbyClient` sends the four existing attempt requests with captured robot,
  direction and current match/round/attempt/version context. Only a bound active
  bidder can create them. They share the existing single pending mutation slot;
  additional taps are dropped, not queued. No optimistic positions/count/scoring.
- An acknowledgment and its authoritative revision must both reconcile before
  controls unlock. Timeout/disconnect preserves the exact request for explicit
  retry even after bidder/phase change. Old socket callbacks stay ignored.
  Rejections and free no-ops have safe inline feedback; no client simulation.
- `ConnectedLobby` reuses `DemonstrationControls` and `LobbyPreview`/`BoardSvg`.
  Selection is immediate local state scoped to the attempt. Selectors remain
  usable while a mutation is pending, but all writes disable until reconciliation.
  Disconnected selectors/board interaction disable too. Spectators, including
  non-active hosts, have only the board and turn/bid/count status.
- Existing 180 ms robot transforms animate confirmed moves, Undo and Reset.
  A presentation-only board epoch remounts the SVG on fresh binding, changed
  attempt identity or skipped versions. It never changes server state or delays
  commands until animation completes. Existing reduced-motion CSS is unchanged.
  Reset changes count to zero immediately with its snapshot and moves robots
  directly together; no history playback or new protocol metadata exists.
- Success/exhaustion snapshots retain a read-only board, actual round number,
  result text and accessible pending retry/reconnect. There is no Continue button
  yet; the full modal/progression remains T16.3. No server/game-rule changes.
- `pnpm --filter @robot-puzzle/web test`: 285 tests passed, including new adapter
  ordering/capture/no-queue/retry/permission/animation-epoch cases and presentation
  active/spectator/pending/disconnected/result coverage. These are deterministic
  adapter and server-rendered-markup checks, not browser visual or touch evidence.
- Web type checks, web production build, 390 shared-contract tests and whitespace
  checks passed. Existing robot-transform/reduced-motion CSS was inspected and
  left unchanged; no browser rendering test was performed in this checkpoint.
- After receiving the twelve-item PC/phone checklist, the owner reported that
  all checks work: active-only controls, immediate selection, synchronized movement/
  counts, free blocked inputs, Undo, simultaneous direct Reset, bid-limit
  corrections, immediate Give Up/rollover, success, exhausted bidders, explicit
  reconnect restoration and usable phone layout without horizontal overflow.
  This is owner-reported evidence, not agent-operated browser/device verification.
  Exact devices/browser versions and measured latency were not supplied; no
  iPhone Safari, automatic recovery or full ten-round match pass is inferred.
