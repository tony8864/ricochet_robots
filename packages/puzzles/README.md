# Puzzle catalog

The package exports a deterministic, checked-in catalog of complete 16×16
boards. The catalog contains five original, individually designed layouts,
each defined in its own file under `src/boards`:

| Board ID | Name | Definition |
| --- | --- | --- |
| `starter-board` | Starter Board | `src/boards/starterBoard.ts` |
| `crossroads` | Crossroads | `src/boards/crossroadsBoard.ts` |
| `switchback` | Switchback | `src/boards/switchbackBoard.ts` |
| `pinwheel` | Pinwheel | `src/boards/pinwheelBoard.ts` |
| `constellation` | Constellation | `src/boards/constellationBoard.ts` |

Coordinates use the game-engine convention: zero-based `{ row, column }`,
origin at the top left. Every board has the fixed blocked center, four legal
initial robot positions, and all 17 colored/vortex targets.

All five boards have irregular target coordinates, mixed color/symbol
assignments, and all four wall-corner orientations. The four additional layouts
each include one single wall extending inward from each outer border. These
placements are saved in the dataset and remain stable on reload. The playable
demonstration uses the board selected by `DEMO_BOARD_ID`; see the preview steps below.

## Wall and target design rules

- Every target cell has two perpendicular wall edges meeting at one of its
  corners.
- A wall segment must meet a perpendicular segment at an endpoint, forming an
  angle, unless exactly one endpoint touches the outer board border and its
  other endpoint is interior.
- Outer boundaries and edges next to blocked cells remain implicit and are not
  stored as walls.

These geometric checks do not prove target solvability. That is reserved for
the solver/round-generation tasks.

## API

- `createBoard(definition)`: builds targets and their corner walls from explicit
  placements, supplies the blocked center, and throws descriptive errors for an
  invalid board. This validates geometry, not solvability.
- `puzzleCatalog`: readonly list of complete board entries.
- `starterBoard`: the initial testing board.
- `getPuzzleBoard(id)`: returns the matching board or `undefined`.
- `validateCatalog(value)`: validates entries, target completeness, wall
  geometry, and the target-angle/wall-pair design rules.

Validation delegates board, robot, and target rules to
`@robot-puzzle/game-engine` and adds catalog-specific checks.

## Adding your own board

### 1. Copy the current board file

Copy `src/boards/starterBoard.ts` to, for example, `src/boards/myBoard.ts`.
Change the exported variable to `myBoard`, give it a unique `id` such as
`my-board`, and choose its display `name`.

Each board file calls `createBoard` with its own robot starts and target
placements. There is no positional color/symbol assignment and no randomness.
You can reorder the target entries without changing which target they describe.

### 2. Edit the placements

Each colored target is one explicit entry:

```ts
{ robotId: 'red', symbol: 'star', row: 3, column: 12, corner: 'bottom-right' }
```

The vortex has no robot color:

```ts
{ symbol: 'vortex', row: 11, column: 14, corner: 'top-right' }
```

- Both `row` and `column` range from **0 through 15**. Rows go downward;
  columns go rightward. `(0, 0)` is the top-left cell.
- Keep one of every combination of `red`, `blue`, `green`, `yellow` and
  `star`, `crescent`, `triangle`, `square`, plus exactly one `vortex`.
- Each target must occupy a different cell outside the blocked center
  `(7,7)`, `(7,8)`, `(8,7)`, `(8,8)`.
- `corner` adds walls on the named sides of that cell:

| Corner | Wall sides |
| --- | --- |
| `top-left` | Top and left |
| `top-right` | Top and right |
| `bottom-right` | Bottom and right |
| `bottom-left` | Bottom and left |

For example, the red star above creates walls between `(3,12)` and `(4,12)`,
and between `(3,12)` and `(3,13)`. Do not add those walls a second time.
Generated walls must connect valid neighboring cells; do not point a corner
outside the board or into a blocked center cell.

Target IDs are generated automatically (`red-star`, `blue-crescent`,
`wildcard-vortex`, etc.). They must be unique within each board; different
boards can use the same target IDs.

Set `initialRobots` to four distinct, in-bounds, non-blocked cells. Keeping
the existing four corner starts is fine.

### 3. Register the board

In `src/catalog.ts`, import your board and add it to the array:

```ts
import { myBoard } from './boards/myBoard';
import { starterBoard } from './boards/starterBoard';
import type { PuzzleBoard } from './types';

// Append myBoard to the existing list; keep the other registered boards.
export const puzzleCatalog: readonly PuzzleBoard[] = [
  starterBoard,
  // ...other existing boards...
  myBoard,
];
```

Keep the existing `getPuzzleBoard` function. You do not need to change
`src/index.ts` for each new board: consumers can call `getPuzzleBoard('my-board')`.
Registration is explicit; files are not discovered automatically.

### 4. Check your board

From the repository root:

```sh
pnpm --filter @robot-puzzle/puzzles test
pnpm --filter @robot-puzzle/puzzles typecheck
```

The catalog tests check every registered board and reject duplicate board IDs.
`createBoard` also validates each definition when its module loads, reporting
the board ID and paths of invalid data. These checks do **not** prove targets
are solvable or that a board is suitable for ten rounds.

### 5. Preview it in the demonstration

In `apps/web/src/fixtures/demoGameState.ts`, change the single board ID setting:

```ts
export const DEMO_BOARD_ID = 'my-board';
```

Geometry, initial robot positions, and all targets come from that selected
catalog entry automatically. An unknown ID produces a descriptive error.
Available IDs are `starter-board`, `crossroads`, `switchback`, `pinwheel`,
and `constellation`. The current demonstration selection is `crossroads`.

The active target stays `blue-star`. Only the original starter board's two-move
solution has been verified. Demo/rendering tests follow the selected board;
the known-solution regression test always checks the starter board separately.

## Optional extra walls

For walls not attached to a target, a board definition can include
`additionalWalls`. These use the engine's blocked-cell-edge format, **not
graphical vertex coordinates**:

```ts
additionalWalls: [
  // A horizontal wall between these cells, touching the left outside border.
  { first: { row: 0, column: 0 }, second: { row: 1, column: 0 } },
],
```

`first` must come before `second` in row-major order (smaller row, then smaller
column). Cells must be orthogonally adjacent. Extra walls must follow the same
angle/border rules above; duplicate walls are rejected.

## Code organization

- `src/boards/*.ts`: one definition per board; start here when adding content.
- `src/catalog.ts`: registration and lookup only.
- `src/createBoard.ts`: target IDs, corner-wall generation, and validation on construction.
- `src/geometry.ts`: shared corner-wall helpers.
- `src/validation.ts`: catalog and board-design checks.
- `src/types.ts`: authoring and compiled-board types.
- `src/index.ts`: public package API.
