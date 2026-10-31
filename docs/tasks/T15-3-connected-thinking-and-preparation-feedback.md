# T15.3 — Connected Thinking and Preparation Feedback

## Status and goal

Implemented on 2026-10-31; automated verification passed. The owner subsequently
reported that it works and requested T15.4; device-specific observations were not
independently recorded. Follows [T15.2](T15-2-durable-bounded-target-preparation.md).
Use authoritative preparation/Thinking snapshots in the real connected UI,
without the local simulator. Part of [T15](T15-server-owned-phases-bidding-and-timers.md).

## Scope

1. Inspect existing connected lobby/client and local phase presentation. Reuse
   visual components and the approved dark-blue/yellow styling rather than create
   another game screen system. Keep the local development simulator separate.
2. Replace the T14 placeholder with actual Preparing feedback. Normally progress
   directly into Thinking when the server reveals a verified target; don't add an
   artificial delay or dismiss preparation before an authoritative snapshot.
3. Show distinct deferred, unavailable and operational-error messages. For the
   authenticated host only, show Retry when the server declares it eligible,
   respecting cooldown/pending/connection state. Guests wait; unavailable has no
   Retry. No board-generation error inside the round-result modal.
4. Send the exact validated retry request with current context. Reuse pending
   command/revision reconciliation and immutable retries for lost replies. A
   delayed result or old socket callback cannot restart preparation, revert a
   newer snapshot or enable another fresh action prematurely.
5. Render Thinking from the authoritative locked board, target, round number,
   official positions and roster. Keep the board square and read-only. No D-pad,
   robot simulation, countdown before a bid, or locally chosen target.
6. Reuse existing Your Bid and Player Bids presentation where practical, but do
   not expose an enabled Place Bid action until T15.4 connects it. Keep unsupported
   connected Skip/Continue/movement actions absent rather than call local logic.
7. Retain connection feedback and room-code placement/copy behavior. Do not
   change board rendering, general responsive rules, certificate setup or the
   entry flow as part of this checkpoint.

## Likely files

- `apps/web/src/lobby/liveLobbyClient.ts`, `ConnectedLobby.tsx` and existing phase/
  preparation presentation, with focused scoped styling and tests.
- Existing bid/roster components only where presentation extraction is needed;
  no state-management framework or broad transport rename/refactor.

## Checks and completion

- Client tests for working/deferred/error/unavailable, host/guest eligibility,
  cooldown, disconnected/pending state, exact retries, delayed acknowledgments,
  stale snapshots and authoritative Preparing-to-Thinking transition.
- Verify current target/positions come from snapshots and no local preparation,
  move, deadline or bid acceptance is triggered by rendering.
- Relevant web/shared tests, type checks, build and whitespace checks.
- Owner-visible checkpoint: PC and phone start into the same Thinking target;
  record actual device checks separately. Error fixtures belong in tests/dev
  harnesses, never public server backdoors.

Stop before enabling bids or countdowns. No claim of complete multiplayer gameplay
or automatic mobile recovery.

## Implementation record — 2026-10-31

- Connected Preparing now shows working, deferred, unavailable and sanitized-error
  feedback. Retry is shown only to the host when server metadata permits it;
  connection, cooldown and unresolved requests disable new actions. Guests wait
  for the named host. Unavailable/working never expose a fresh Retry.
- The existing adapter has one shared Start/Shuffle/preparation pending slot.
  New Retry uses the current match/preparation IDs. Lost replies keep the exact
  original request through reconnect and even a later Thinking snapshot. Results
  reconcile with authoritative revisions; stale snapshots/old socket events cannot
  restore an earlier phase. No local solver/controller or optimistic target.
- Cooldown display uses server `availableAtMs - serverTimeMs` and a cleaned-up
  one-shot timer, not a client wall clock or authority change. The server remains
  the final eligibility check; local backgrounding may delay enabling the button.
- Shared `LobbyPreview` presentation accepts current robots, active target, round
  heading and alternate roster content. Preparing uses official positions rather
  than catalog starts. Thinking shows the server target, current positions and
  round; existing Your Bid/Player Bids are reused with editing/submission disabled.
  Room-code copy and connection feedback remain. No countdown, Skip, Continue,
  selection, movement or simulation is added.
- Changes are limited to connected web client/presentation, optional disabled bid
  card support, two scoped CSS rules, tests/fixtures and documentation. Board SVG,
  general responsive layout, backend and game rules are unchanged by T15.3.
- Web tests: 243 passed (20 added); shared regressions: 390 passed. Web TypeScript,
  production build and whitespace checks passed. No full workspace/server rerun
  is claimed for this web-only checkpoint.
  No physical-device, browser visual or complete multiplayer gameplay check is
  claimed. No dependencies, trust settings, commit or deployment changed.

## Owner review

With the existing backend/frontend HTTPS setup running, refresh PC and phone,
create/join with two identities and Start. Both should show the same highlighted
target, Thinking and Round 1 of 10, read-only robots, disabled Your Bid and the
player-bids list. Room-code copy and connection feedback should remain usable.
Normal preparation can be brief; no artificial delay is added. Error variants
are covered by private fixtures/tests, not public server cheat controls.
