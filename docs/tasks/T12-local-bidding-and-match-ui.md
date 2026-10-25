# T12 — Local Bidding and Match UI

## Status and goal

In progress: T12.1 implemented with automated checks; browser smoke verification
was unavailable. T12.2–T12.6 remain pending. The owner approved this breakdown
after completing T11. This task is
the local, single-browser prototype, not authoritative multiplayer.

Let one person play an entire ten-round match by acting for a simulated group.
Reuse T11's match model and the existing board/demonstration UI. Keep the board
as the stable centerpiece; replace the controls below it according to phase.

Read `docs/product.md`, `docs/architecture.md`, `packages/match/README.md`, and
the selected subtask before implementation. Product rules win. Work on one
explicitly requested subtask at a time; this document does not authorize all six.

## Agreed approach

- One browser tab, one shared local match state, and a clearly labeled
  development-only **Act as** player selector. No separate host/player windows.
- The host is a roster player with setup/skip permissions, not a separate account
  type. Current host identity and the viewed/acting seat are separate values.
  Switching seats changes neither host authority nor active bidder.
- Connect the existing demonstration UI to T11 first (T12.1), before building
  the other phase panels. T12.4 is demonstration feedback/polish, not a second
  implementation of movement or match integration.
- `main.tsx` continues mounting `App`. The app/controller chooses the panel from
  local pre-match setup or `match.phase`; no routing library is needed.
- In pre-match, preview a complete catalog board. Only the host may shuffle or
  start. Once started, that board remains locked for all ten rounds.
- Hide robot selectors, D-pad, and attempt actions during Thinking/Bidding.
  The same bid panel can grow a countdown and bid list once bidding begins.
- During Demonstration, reuse selectors, D-pad, Undo, Reset, and Give Up; only
  the active bidder can interact. Other simulated seats watch read-only.

## Screen responsibilities

| Local state | Content and controls |
| --- | --- |
| Pre-match (outside T11) | Board preview, roster/host, host-only Shuffle Board and Start Match |
| Preparing | Read-only board, preparing or deferred/unavailable feedback; explicit bounded retry on failure |
| Thinking | Active target/round, own bid input and Submit Bid; confirmed host-only Skip Round |
| Bidding | Same bid panel, countdown, all accepted bids, submit/lower own bid |
| Demonstrating | Active bidder, bid/moves/target, existing controls for active seat; read-only watcher view |
| Round Result | Outcome and updated scores; Continue invokes trusted local controller advance |
| Finished | Final score-ordered standings and all shared winners; no next round |

The Act as switcher and any test-time controls stay visually separate from game
controls and clearly describe local simulation. Do not imply separate clients,
online connectivity, authenticated identities, or offline multiplayer support.

## State and integration boundaries

1. Use `createMatch`, `prepareMatchRound`, `transitionMatch`, and `getMatchResults`
   from the public match API. Do not duplicate scoring, deadlines, turn selection,
   bid ordering, target completion, or rollback in React.
2. T11 state owns board, targets, official/attempt positions, scores, bids, round,
   and phase. React may own presentation state: selected robot, bid draft, focused
   control, viewed seat, confirmation UI, and local setup selection.
3. Remove the standalone `attempt`/`givenUp`/demo bid-limit authority when adapting
   `App.tsx`. Do not maintain two writable game states or import match internals.
4. Display attempt positions only while Demonstrating; otherwise official
   positions (or catalog starts before match creation). All 17 targets remain
   visible; only an actual active target is highlighted. If needed, allow the
   existing SVG component to represent no active target without changing geometry.
5. The local controller supplies actor/host/time and always consumes returned
   state, including rejections with an independently due deadline transition.
   Disabled buttons supplement, not replace, domain validation.
6. Local time is injectable for deterministic tests. The browser adapter supplies
   time and requests expiry; the countdown is derived from the absolute deadline,
   not a decrementing source of authority. Later multiplayer replaces this adapter
   with server snapshots/commands; browser time will not be multiplayer authority.
7. Preparation is explicit and bounded, outside rendering/state-updater functions.
   React StrictMode must not double-start/advance matches or cause repeated target
   consumption/search loops. Never render or expose solver proofs or hints.
8. Deferred/unavailable preparation leaves the match Preparing, preserving all
   committed data. Offer an explicit local retry with the documented budget, not
   automatic deepening, resets, target reuse, board substitution, or a shorter match.
   This is local feedback/testing, not approval of a live recovery policy.

## Ordered subtasks

- [x] [T12.1 — Local controller and demonstration integration](T12-1-local-controller-and-demonstration-integration.md) (automated checks passed; browser smoke unavailable)
- [ ] [T12.2 — Pre-match board preview, host shuffle, and start](T12-2-pre-match-board-preview-and-start.md)
- [ ] [T12.3 — Thinking, bidding, countdown, and no-bid skip](T12-3-thinking-and-bidding-ui.md)
- [ ] [T12.4 — Demonstration feedback and permissions polish](T12-4-demonstration-feedback-and-permissions.md)
- [ ] [T12.5 — Round results, continuation, and final standings](T12-5-round-results-and-final-standings.md)
- [ ] [T12.6 — Full-flow and mobile verification](T12-6-full-flow-and-mobile-verification.md)

Each subtask includes focused tests and a usable checkpoint. T12.6 verifies their
composition; do not postpone correctness checks until the last task.

## Scope exclusions

No real rooms/joining, networking, credentials, host transfer, server alarms,
durability, retry deduplication, reconnection, or deployment. No new state
framework, UI kit, routing library, or speculative backend abstractions. A web
workspace dependency on the existing match package is expected, not a new library.
Rematch/restart behavior and its confirmation policy are not added implicitly;
finished results are sufficient for T12. Do not start T13 automatically.

## Verification and completion

Use existing test conventions; add controller/component tests and proportionate
browser interaction coverage for UI behavior. Use controlled clocks, fixed board
and candidate orders, and valid proofs in fixtures. Never put fixture solutions
in a player-facing control. Prefer existing tooling; justify new test dependencies
before adding them. Run relevant tests/type checks after each implementation.

For T12 completion run web/match and workspace tests, workspace type checks,
production build, and whitespace checks. Record browser/mobile checks, including
the actual device or emulation used; distinguish real iPhone Safari testing from
desktop emulation and report anything unavailable. Preserve existing square board,
movement animation/reduced-motion behavior, narrow-screen layout, and >=44px
interactive touch targets. No broad responsive redesign is authorized.

Complete when a simulated group can play ten rounds through UI, with correct
permissions, read-only thinking/bidding, real carry-forward preparation, failure
feedback, and shared winners. Update task status, plan, and usage docs with actual
evidence. Do not claim universal target supply or multiplayer readiness, and do
not commit without a separate request.

## T12.1 checkpoint (2026-10-25)

The dev app now uses one real T11 match controller, Act as switching, and the
adapted existing demonstration. A real-selector starter runs once before React;
non-demo phases are placeholders, not later-screen implementations. All 444
workspace tests, type checks, and build passed. No browser surface was available
for smoke testing; preserve the manual check in T12.1/T12.6. README explains the
dev-only entry and production placeholder. No commit or next subtask was started.
