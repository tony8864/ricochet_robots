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

These geometric checks do not prove target solvability. The separate hidden
solver can verify a particular target from particular current robot positions;
live round selection remains T10.

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

## Hidden solver (T09)

Import the separate subpath so catalog consumers do not pull in solver tooling:

```ts
import { solvePuzzle } from '@robot-puzzle/puzzles/solver';

const result = solvePuzzle(
  { board, robots: currentOfficialRobots, target },
  { maxExpandedStates: 50_000, maxStoredStates: 150_000 },
);

if (result.status === 'solved') {
  // result.moves is a proof, not a player-facing hint.
} else if (result.status === 'unknown') {
  // result.reason is 'expansion-limit' or 'storage-limit'. Not "impossible".
} else {
  // 'unsolvable' means the complete reachable state space was exhausted.
}
```

The state is runtime-validated with engine validators; invalid state throws
`TypeError`, invalid limits throw `RangeError`. An already-complete target returns
an empty solution even with zero allowed expansions. The caller must supply
both limits: a nonnegative safe integer for expansions, and an integer from 1
through `MAX_STORED_STATES` (1,000,000) for stored states. That upper bound is an
implementation safety ceiling, not a live-server recommendation. No depth limit
or wall-clock timeout is used.

The deterministic breadth-first search tries robots in red/blue/green/yellow
order and directions in up/right/down/left order. State keys preserve all four
identities. Paths use parent indices; no-ops and previously visited states are
not enqueued. Static wall stops are computed once per call, then adjusted for
the other robots. Tests compare these transitions with engine movement.

`stats` counts partially expanded final nodes, attempted directional inputs,
non-no-op generated successors (including duplicates), and peak unique retained
states. A successful final state is returned without being retained, so it is
not included in `peakStoredStates`. The root counts as one retained state.
Budget checks never exceed the configured caps; exhaustion exactly at a cap
can still prove impossibility. A goal can also be returned at the storage cap
if it is encountered before a successor requiring another stored state.

Queue, parent, and move arrays reserve exactly `9 * maxStoredStates` bytes when
search starts. `stats.searchArrayBytes` reports this allocation (zero for an
initially complete state or zero-work return). The visited Set has at most
`maxStoredStates` entries; its implementation-specific overhead is additional.
Indexed wall stops occupy another 1,024 bytes, excluding setup temporaries.
There are at most 16 attempted moves per expanded state.

Run the standalone benchmark with:

```powershell
pnpm --filter @robot-puzzle/puzzles benchmark:solver
```

It uses the existing Vitest runner plus development-only Node type definitions,
runs separately from unit tests, and rewrites the generated evidence file
`docs/benchmarks/T09-solvability-results.json`. The harness fixes its budgets and
fixture order in `benchmarks/solver.benchmark.ts`, performs one warm-up and three
measurements per case, and independently replays every returned solution.
Read `docs/benchmarks/T09-solvability.md` for results and limitations.

The solver is synchronous, with no clocks, randomness, IO, or shared mutable
cache. Deterministic caps bound work/storage, not elapsed milliseconds. Nothing
is wired into the UI or live round selection, and the measured budget/fallback
still needs owner approval before T10.

## Preparing the next round (T10)

```ts
import {
  prepareNextRound,
  RECOMMENDED_ROUND_SETUP_BUDGET,
} from '@robot-puzzle/puzzles/round-setup';

const result = prepareNextRound({
  puzzle,
  robots: currentOfficialRobots,
  usedTargetIds,
  candidateOrder: shuffledTargetIds,
  budget: RECOMMENDED_ROUND_SETUP_BUDGET,
});

if (result.status === 'selected') {
  // result.round contains boardId, target, and a copy of roundStartRobots.
  // Keep result.internalProof internal. T11 records the target as used on reveal.
}
```

`candidateOrder` must contain every board target exactly once; the caller owns
shuffling. `usedTargetIds` must contain distinct IDs from that board. Catalog
geometry, initial and current robot positions, IDs/order, and budgets are
runtime-validated. Invalid state/IDs throw `TypeError`; invalid budgets throw
`RangeError`. Validation also runs when no candidates are eligible.

The selector filters used targets, then unused targets already completed by the
current robots. Colored targets require their matching robot; the vortex accepts
any robot. Filtered/unverified targets remain unused. Each eligible candidate is
examined at most once, in supplied order, until a solution is independently
replayed through the engine or the budget is exhausted. This does not promise
uniform sampling of all solvable targets or rank puzzles by difficulty.

Budgets are required. The explicit recommended configuration allows 50,000
expansions and 150,000 stored states per candidate, with 200,000 actual expansions
across one invocation. Each subsequent search receives the smaller of the
per-candidate allowance and remaining total work allowance. Work on unsuccessful
searches counts too. Zero work allowance never starts a search.

Results distinguish:

- `selected`: `round` holds copied target/round-start data; `internalProof` is
  separate verification data that must not enter a public room snapshot.
- `unavailable`: `all-targets-used`, `all-unused-targets-complete`, or
  `all-eligible-targets-unsolvable` (every eligible search was exhaustive).
- `deferred`: `total-expansion-limit` leaves eligible candidates untested;
  `candidate-expansion-limit` means the per-candidate work cap is zero;
  `unverified-candidates` means every eligible target was examined but some
  searches remain inconclusive. A deferred target is never labeled impossible.

All results contain diagnostics: filtered/eligible/untested counts, aggregate
expansions, and per-candidate outcome, supplied allowance, and solver statistics.
Returning a prepared round does not update official state or the used-target
set. The caller must record the revealed target as used regardless of its later
round result. All four supplied positions become the round-start snapshot; the
solver's final positions do not become official positions.

The API returns promptly when its deterministic budget ends. No wall-clock
deadline or automatic retry is involved. On deferred/unavailable results, the
caller preserves official state and reveals no target. Live recovery scheduling
and feedback remain a separate integration decision before multiplayer use.
The bounds do not guarantee that every possible match can finish ten rounds.

Measure complete calls with:

```powershell
pnpm --filter @robot-puzzle/puzzles benchmark:round-setup
```

See `docs/benchmarks/T10-round-setup.md` and its generated JSON evidence. The
command is separate from the T09 solver benchmark and does not rewrite T09 data.
No new dependencies, proof cache, match state machine, or UI are needed for this
pure selection API.

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
