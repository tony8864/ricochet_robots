# T19.3 — Online-Only Feedback and Mobile Presentation

Status: implemented and automated verification passed on 2026-11-04.
Physical keyboard/safe-area/Safari checks remain T19.4, not claimed verified.
Parent: [T19](T19-pwa-and-mobile-lifecycle.md).

## Scope

- Review existing entry/reconnect feedback first. Add a concise explanation that
  live multiplayer requires internet where missing, particularly on cached entry
  and offline/recovery states. Reuse existing presentation instead of adding a
  second status banner or replacing working reconnect behavior.
- Cached assets must not imply an active connection. Keep Create/Join and live
  actions disabled when known offline or not synchronized, using existing
  transport state and server validation. Browser online events alone do not prove
  server connectivity. Preserve exact uncertain-command Retry and intentional
  Leave behavior; do not queue new offline inputs.
- Review existing safe-area rules in browser and standalone contexts: entry,
  lobby, active header/board/controls, menus, dialogs and final results. Make only
  small necessary CSS/metadata corrections for notches, home indicators, dynamic
  viewport height and keyboard scrolling.
- Preserve responsive breakpoints, a square board, readable symbols and minimum
  44×44 px touch targets. Do not redesign the header/controls, board renderer or
  selection highlighting. Allow necessary scrolling on short screens rather than
  clipping actions or forbidding zoom.
- Exercise existing visibility/resume/BFCache/network recovery after lock and
  app switching. Fix only a demonstrated small in-scope issue with regression
  coverage; stop for review if it requires identity, protocol or server changes.

## Likely files

Existing entry/connection components, `apps/web/src/styles.css`, HTML metadata if
needed, focused frontend/browser tests and PWA verification instructions. No new
state machine, game logic or backend lifecycle policy is planned.

## Acceptance and checks

Verify online-only explanation, cached offline launch, disabled offline actions
and recovery against fresh snapshots without duplicate seats or command replay.
Check narrow portrait, short viewport/keyboard, tablet and desktop presentation;
distinguish emulated geometry from actual OS safe areas and device suspension.

Run relevant frontend/browser tests, type checks, production build and whitespace
checks. Report which CSS changed and why, or record that existing rules sufficed.
Stop before final T19.4 device verification; do not change game rules or deploy.

## Implemented changes

- Added `apps/web/src/pwa/useBrowserOnline.ts`, a React subscription to the
  existing `browserRecoveryEnvironment`. No independent reconnect controller,
  timers, identity state, offline command queue or optimistic state were added.
- `RoomEntry.tsx` disables Create/Join/exact Retry and recovery Reconnect when
  the browser reports offline. Submit/click handlers check the current hint too,
  preventing keyboard/race submissions without discarding drafts or uncertain
  entry requests. Coming online re-enables the appropriate action, never submits
  it. The existing footer announces offline status instead of adding a new banner.
- `ConnectedLobby.tsx` additionally gates existing connected actions and its
  Reconnect button on that same hint. Only real adapter/server binding can
  establish connection; an online event is not proof of server availability.
- `index.html` adds `viewport-fit=cover` without limiting zoom. `styles.css`
  adds max(existing padding, safe-area inset) to the board page, preserving
  zero-inset 5px edges and compact-landscape padding. Body/root dynamic viewport
  minimums retain `vh` fallback. Existing entry/results/modal safe-area and
  scrolling rules remain. No breakpoint, board renderer or game rule was changed.

## Verification and evidence

Frontend tests cover known-offline entry/retry rendering and stale connected
presentation. Additional lifecycle tests exercise visibility hide/show,
persisted/non-persisted pageshow, online/offline hints and listener cleanup using
controlled EventTargets. These are event-handler tests, not real BFCache/native
Safari suspension evidence.

New production browser cases verify no POST on offline keyboard submission,
editable drafts, locked uncertain fields, no automatic submit on an online hint,
and explicit retry recovery. Geometry checks cover entry, live lobby, menus,
End Room dialog, Thinking/bid controls, active demonstration and round result.
The existing actual ten-round test now also checks final standings/New Match at
the same sizes. All boards remain square, HTML input/button touch targets are
at least 44px, no horizontal overflow is permitted, and short-view actions can
be reached through natural/internal scrolling. SVG robot cells are not claimed
to be 44px; dedicated robot selection controls are.

Measured viewports: 320×568, 375×667, 390×844, 768×1024, 1032×1376,
1280×800 and 390×320. The last is a short viewport/focus/scroll test, not an
actual software keyboard. Existing layout behavior is preserved, not a guarantee
that every board/control fits vertically without scrolling on every screen.
Short entry/demo screenshots were reviewed; artifacts remain local and ignored.

Checks already run:

- `pnpm --filter @robot-puzzle/web test`: 430/430 passed (39 files).
- `pnpm typecheck`: workspace and isolated service-worker checks passed.
- `pnpm build`: production build passed (Vite 7.3.7).
- Focused mobile cases: 2/2 passed; standalone recovery: 3/3 passed.
- Final `pnpm test:e2e`: all 15 cases passed together in 4.2 minutes after clock
  isolation, including actual ten-round/results/rematch and all recovery cases.
- `git diff --check` and local documentation links: passed. Existing LF/CRLF,
  Miniflare SQLite alarm-cancellation and Node color notices remain warnings.

An initial layout run used the shared bid helper with a singular bid its text
locator did not support; the fixture now uses ordinary 4/5 bids. An initial full
browser run passed 14/15 but stalled in the next file's preparation: the new
clock-advancing mobile file shared a worker-scoped private clock with recovery.
`environmentKey: 'pwa-mobile'` now gives that file its own isolated runtime,
preventing its future clock offset from delaying another file's new jobs. No
timeout, solver budget, product clock, preparation policy or backend changed.
The complete 15-case suite subsequently passed with that explicit isolation.

The full workspace unit suite was not rerun for this frontend-only checkpoint;
all 430 frontend tests, full browser regression, workspace types and production
build were run. Existing solver/preparation budgets and known broader coverage
limits remain unchanged.

Manual device evidence is separate: the owner confirmed Android installation and
basic offline cold-launch/error/online recovery after T19.2, before these newer
disabled controls. Physical iPhone, OS safe insets, actual keyboard behavior,
manual update adoption and T19.3 control review remain T19.4. See
[PWA testing](../pwa-testing.md). No dependency, commit, deployment, trust setting
or unrelated user change was modified.
