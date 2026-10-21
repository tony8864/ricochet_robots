# T08b — Original Full-Board Catalog and Validation

## Goal

Create five original, individually designed 16×16 boards in `packages/puzzles`,
with one file per board and a shared authoring helper. The owner requested the
four additional layouts after testing the starter and reviewing the authoring
format.
Use a catalog board directly in the existing playable demonstration, with its
catalog targets and initial robot positions. Select the board by changing only
`DEMO_BOARD_ID` in `apps/web/src/fixtures/demoGameState.ts`.

Match variety comes from selecting a complete board. Quadrant assembly,
rotation/rearrangement, and procedural wall generation are outside this task.
Each board includes 17 predefined targets: each combination of four robot
colors and four symbols, plus one vortex wildcard. Catalog geometry validation
does not prove target solvability; that remains T09–T10.

## Board-design rules

- Each target cell is enclosed at one corner by two perpendicular wall edges
  that meet at that cell corner.
- Wall segments in the board interior are paired with a perpendicular segment
  at an endpoint, forming an angle.
- A wall may be unpaired only when exactly one of its endpoints touches the
  outer board border and its other endpoint is inside the board.
- Outer board boundaries and edges adjacent to blocked cells are implicit
  barriers, not explicit wall data.
- Use an original layout; do not copy a commercial board.
- Spread targets across irregular positions and use all four wall-corner
  orientations, with mixed colors and symbols. Store the resulting design as
  fixed board data.

## Acceptance criteria

- The public catalog contains five distinct full-board designs, each with a
  stable, unique, non-empty ID and readable name. Each definition lives in its
  own file; `catalog.ts` handles registration and lookup.
- Each defines a valid 16×16 board, blocked central 2×2, and four distinct legal
  initial robot positions.
- Each has exactly 17 targets at distinct legal cells: one of each colored
  symbol/robot combination and exactly one vortex wildcard.
- Every target has its required perpendicular wall corner.
- Every explicit wall obeys the wall-pair rule and uses the engine's canonical
  undirected blocked-edge representation.
- Catalog validation gives useful context for invalid IDs, target data,
  geometry, robot positions, missing target angles, or unpaired interior walls.
- The demonstration renders and uses the selected catalog board directly,
  including its walls, targets, and initial robot positions. Selection,
  movement, undo, reset, and Give Up remain available. Keep a separate
  starter-board regression for its known two-move blue-star solution, undo,
  and reset. Selecting another board does not assert target solvability.
- Deterministic tests cover the complete catalog, distinct layouts, lookup behavior, and focused
  invalid catalog fixtures. Validation does not mutate input data.
- Relevant package/workspace checks pass. The catalog's geometry must not be
  described as a solvability guarantee.

## Implementation boundaries

Reuse `Board`, `RobotPositions`, `Target`, `CENTER_BLOCKED_CELLS`,
`ROBOT_IDS`, `COLORED_TARGET_SYMBOLS`, `validateBoard`, and
`validateGameState` from `@robot-puzzle/game-engine`. Keep catalog-specific
validation in the puzzles package; do not duplicate engine movement/geometry
rules. Keep it pure TypeScript, without React, browser APIs, networking,
timers, or randomness.

Expose a readonly catalog and a lookup by board ID. An unknown ID should return
an explicit missing result such as `undefined`. Document the coordinate
convention and API in `packages/puzzles/README.md`.

Out of scope: solver or solvability benchmark (T09), target selection/fallback
(T10), match state (T11), preview/shuffle UI (T12/T14), and deployment.

## Verification

Run the focused package checks and then workspace checks when available:

```powershell
pnpm --filter @robot-puzzle/puzzles test
pnpm --filter @robot-puzzle/puzzles typecheck
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Review the board geometry separately from automated checks. Neither visual
review nor catalog validation substitutes for T09–T10 solvability validation.

## Completion status

Complete for the agreed T08 scope; the owner requested the commit. The five-board
catalog, authoring helper and guide, geometry validation, SVG rendering, and
single-setting demonstration selection are implemented. The current demo board
is `crossroads`. All 140 workspace tests, workspace type checking, the web
production build, and diff whitespace checks passed. Only the starter board's
known blue-star solution is verified; full solvability remains T09–T10.
