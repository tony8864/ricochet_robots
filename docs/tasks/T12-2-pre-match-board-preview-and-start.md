# T12.2 — Pre-match Board Preview, Host Shuffle, and Start

## Status and goal

Pending after T12.1. Read the [parent](T12-local-bidding-and-match-ui.md), product,
and architecture. Replace the temporary starter path with real local setup.

## Scope

1. Add pre-match setup outside the T11 phase union, using the existing catalog
   and fixed local roster/host. Preview the selected full board, all targets,
   and its catalog robot starts; no active-round highlight or movement controls.
2. Add host-only **Shuffle Board** and **Start Match**. Shuffle picks another
   complete catalog entry when alternatives exist, not rotations or generated
   walls. Keep random choice caller-owned and injectable/deterministic in tests.
3. Enforce permissions in the local controller as well as the UI. Switching to a
   non-host preserves the preview but cannot shuffle/start. This is a simulation
   permission boundary, not authentication.
4. Start locks the selected puzzle, calls `createMatch`, and explicitly attempts
   first-round preparation with an externally chosen candidate order and existing
   bounded budget. Enter Thinking only on verified selection. Do not force the
   standalone demo target or automatically submit fixture bids in normal setup.
5. Show Preparing feedback. Distinguish deferred/unavailable selection without
   exposing internal proofs; provide an explicit bounded local retry. Preserve
   committed board/roster/positions/counts and never silently select another board.
6. Prevent repeated Start clicks/StrictMode from creating two matches or selecting
   extra targets. After start, remove/disable setup actions for the entire match.
7. If necessary, allow `BoardSvg` to have no active target during preview/Preparing
   without pretending a target was revealed. Preserve its geometry and artwork.

## Likely files

Local controller/setup state, `App.tsx`, a small setup/preparation panel,
corresponding tests, and narrowly scoped styles/SVG prop changes if required.
Do not add room or lobby infrastructure to implement local setup.

## Acceptance and verification

- Host sees/uses Shuffle and Start; non-host cannot invoke either through the
  controller. Shuffle changes the full catalog board, not its internal data.
- Starting uses exactly the previewed board/starts; all ten rounds keep it locked.
- First Thinking state has one used target, zero completed rounds/scores, and
  correct copied start positions. No target is highlighted before verification.
- Failed preparation stays Preparing and an explicit retry consumes no extra
  round/score/target. No unbounded retry or board reset is introduced.
- Test repeated start/shuffle requests after start and deterministic shuffle choice.
- Run focused web tests, web type check/build, and a setup browser smoke check;
  record results and update task/usage documentation.

## Checkpoint and exclusions

Host can preview/shuffle/start into verified Thinking. Its bidding controls may
remain a placeholder until T12.3. No editable roster, joining, authentication,
host migration, rematch/restart policy, automatic recovery, or subsequent subtask
implementation. Do not commit automatically.
