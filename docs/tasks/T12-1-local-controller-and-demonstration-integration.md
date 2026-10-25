# T12.1 — Local Controller and Demonstration Integration

## Status and goal

Implemented on 2026-10-25; automated verification passed, browser smoke verification
unavailable in this session. Read the [parent](T12-local-bidding-and-match-ui.md),
product, architecture, and match README. Connect the app to T11 before building
new phase screens. Reuse the current demonstration rather than duplicating it.

## Scope

1. Inspect `App.tsx`, `BoardSvg`, current styles/animation, and fixture tests.
   Introduce a small local controller/hook with clear UI/domain separation,
   using only the public match API. Add the existing match workspace dependency
   to web as needed; preserve unrelated lockfile entries.
2. Establish a fixed test roster (at least two seats), separate host/acting-seat
   values, and an injectable time source. Add the clearly labeled local **Act as**
   selector; changing it never recreates the match, transfers host, or changes turns.
3. Route domain actions through T11 and always store the returned state, even on
   rejection. Keep selected robot and other presentation-only values local.
4. Adapt the current board/demonstration controls: read `match.puzzle`, current
   target, queue bid, and `match.attempt`; send move/undo/reset/give-up commands.
   Remove standalone attempt/given-up/demo-limit ownership from the active app path.
5. Render according to actual phase. Hide movement/selection outside Demonstrating;
   during Demonstrating only the active acting seat may select/move/reset/give up.
   Non-active seats see a read-only board. Preserve current visuals and animations.
6. Keep a small development-only deterministic starter scenario until real setup
   and bidding panels exist. Reach Demonstrating via creation, verified preparation,
   actual bids, and supplied deadline advancement; never fabricate a phase or
   reveal/auto-play its solver proof. Use minimal phase placeholders when a result
   is reached, rather than implementing later screens now.
7. Keep time/preparation coordination out of rendering and React state-updater
   functions. StrictMode must not duplicate initialization or consume extra targets.

## Likely files

`apps/web/src/App.tsx`, a focused local-controller module/hook and its tests,
small extracted demonstration components if helpful, `apps/web/package.json`,
and the match importer in `pnpm-lock.yaml` if needed. Change `BoardSvg` only for
presentation/input props, not rendering/movement rules. Update web usage docs.

## Acceptance and verification

- The existing demo runs from a genuine T11 Demonstrating state; moves update the
  attempt, success reaches Round Result, and Give Up rolls back or advances bidder.
- Switch between active bidder, another player, and an inactive host. Only the
  active seat can act; switching preserves state, all robot positions, and scores.
- Test free corrections/no-ops and limit behavior through the adapter. Reaching
  the bid limit alone must not fail/lock corrections; T11 remains the authority.
- A rejected late action retains a due expiry transition; controlled time and
  deterministic preparation make tests reproducible. Preparation is bounded.
- UI has no separate writable attempt or local scoring/target-completion logic.
  Existing SVG targets, selected ring, animation, and responsive layout remain intact.
- Run relevant web/match tests and web type check/build; record actual results
  and a browser smoke check, or the precise limitation if unavailable.

## Checkpoint and exclusions

A single-tab match-driven demonstration with player switching and phase
placeholders is sufficient. No pre-match shuffle/start panel, full bidding panel,
results screen, demonstration redesign, networking, or new match rules. T12.2
replaces the temporary starter path; T12.4 polishes this same integrated UI.
Do not implement another subtask or commit automatically.

## Implementation and verification evidence

- `apps/web/src/local/controller.ts` owns one T11 snapshot, separate actor/host,
  subscriptions, injected time, and reducer delegation. It always accepts returned
  state, including rejected late commands that normalize deadline expiry.
- `main.tsx` dynamically loads the dev-only deterministic starter before React
  mounts. Creation, real bounded preparation, Maria/Alex bids, and supplied expiry
  run once outside render/initializers/effects/updaters. The starter has a fixed
  simulated timestamp, no live countdown or automatic proof playback.
- `App.tsx` subscribes with `useSyncExternalStore`; only selected robot remains
  presentation state. Existing markup/classes are reused in `DemonstrationControls`.
  Watchers and an inactive host have no interactive robot/attempt controls;
  transitions render phase placeholders. No later screen was implemented.
- Board rendering/animation/CSS breakpoints are unchanged. `BoardSvg` only widens
  its active-target prop to accept null for unrevealed Preparing state. A small
  separately labeled development toolbar is added; no responsive redesign.
- `local/config.ts` is the single temporary board/roster configuration; legacy
  rendering fixtures re-export that board ID without driving the app's game state.
  The web workspace gains only the existing match dependency; lockfile change is
  its three-line link entry. Offline frozen installation passed.
- Added 12 controller tests and 5 rendered-markup tests. Web: 24 tests passed;
  match: 192 passed; workspace: all 444 tests passed. All workspace type checks,
  web production build, and tracked/untracked whitespace checks passed.
- Tests cover switching, active-only commands, inactive host, free no-ops/undo/
  reset at cap, multi-robot rollback, score-once success, late rejection/expiry,
  stable snapshots/subscription cleanup, phase controls, and no preparation rerun
  on repeated rendering. Mounted browser interaction/animation is not proven by
  server-rendered markup tests.
- Browser smoke check was attempted: browser inventory was empty and opening an
  in-app browser returned `Browser is not available: iab`. Real browser/mobile
  interaction, animation, and StrictMode mounting remain manual verification,
  not claimed passed. This limitation is carried into T12.6.
- README documents `pnpm dev`, Act as, Give Up/switch to next bidder, and reload
  to replay the temporary fixture. Production preview intentionally shows a
  placeholder rather than enabling this dev-only simulation. No server, match
  rule, engine, solver, catalog data, or benchmark changes. Nothing committed.

## Manual checkpoint

Run `pnpm dev`, move as Maria, switch to Alex/Teo to verify watching only, switch
back to Maria and Give Up, then switch to Alex to control the fresh attempt.
After both Give Up, verify the result placeholder has no movement controls.
Reload to rerun the starter. T12.2 replaces this temporary entry with setup UI;
T12.3/T12.5 supply real bidding/result panels. Do not implement them automatically.
