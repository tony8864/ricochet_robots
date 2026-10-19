# T03 — Sliding Movement Implementation Plan

## 1. Goal and acceptance criteria

Implement one pure game-engine operation that moves a selected robot in one cardinal direction. The robot must slide until the next cell would be blocked by the board boundary, a blocked cell, a wall, or another robot. T03 covers geometry and robot positions only; target matching, move history, undo, reset, bid limits, player authorization, and networking remain outside this task.

T03 is accepted when:

- The engine supports `up`, `right`, `down`, and `left` using the existing zero-based row/column convention.
- A robot stops in the last legal cell before every supported obstacle type: boundary, wall, blocked cell, and another robot.
- A robot never overlaps or passes through another robot, crosses a blocked edge, enters a blocked cell, or leaves the 16×16 board.
- A direction that cannot change the robot's position returns an explicit no-op result so callers can avoid counting it as a move.
- The operation is deterministic and does not mutate the board or input robot positions.
- Unit tests cover all four directions, each obstacle type, nearest-obstacle behavior, no-op cases, determinism, and input immutability.
- The new public API is exported from the game-engine package and documented briefly.
- `pnpm --filter @robot-puzzle/game-engine test` and `pnpm --filter @robot-puzzle/game-engine typecheck` pass.
- The implementation has no React, browser, Cloudflare, timer, or networking dependency.

## 2. Relevant existing code and types

The current T02 implementation already establishes the invariants T03 needs:

- `packages/game-engine/src/model.ts`
  - `BOARD_SIZE` fixes the board at 16×16.
  - `Coordinate` uses zero-based `{ row, column }`, with rows increasing downward and columns increasing rightward.
  - `CENTER_BLOCKED_CELLS` identifies the central 2×2 blocked area.
  - `BlockedEdge` represents one undirected wall between adjacent cells. Endpoints are stored once in row-major order.
  - `Board` contains readonly blocked cells and walls.
  - `RobotId` is the four-value union `red | blue | green | yellow`.
  - `RobotPositions` is a readonly record containing one coordinate for every robot.
  - `GameState` also includes a target, but movement does not need the target and should not accept the whole state.
- `packages/game-engine/src/validation.ts`
  - Validates coordinate bounds, required center cells, canonical adjacent walls, unique robot positions, and robots outside blocked cells.
  - T03 should rely on these established invariants rather than repeat full validation on every move.
- `packages/game-engine/src/index.ts`
  - Is the public package export surface and must export the new movement types and function.
- `packages/game-engine/src/model.test.ts`
  - Supplies examples of valid boards and robot fixtures and confirms the T02 invariants.
- `packages/game-engine/README.md`
  - Documents coordinate, blocked-cell, wall, and state conventions. Add a short movement API section without duplicating product rules.

The movement implementation should accept `Board` and `RobotPositions` separately. This keeps it reusable by the future attempt model, server-authoritative room logic, and puzzle solver without coupling it to a target or UI state.

## 3. Proposed movement algorithm

Use a direct cell-by-cell scan. The board is only 16×16, so a move examines at most 15 candidate cells. Build small lookup sets once per call for blocked cells, walls, and the other robots; no caching or preprocessing layer is needed for T03.

Direction deltas:

| Direction | Row delta | Column delta |
|---|---:|---:|
| `up` | -1 | 0 |
| `right` | 0 | 1 |
| `down` | 1 | 0 |
| `left` | 0 | -1 |

Pseudocode:

```text
function moveRobot(board, robots, robotId, direction): MoveResult
  start = robots[robotId]
  current = start
  delta = deltaFor(direction)

  blockedCells = set of coordinate keys from board.blockedCells
  blockedEdges = set of canonical edge keys from board.walls
  occupiedCells = set of positions of every robot except robotId

  loop
    next = current + delta

    if next is outside [0, BOARD_SIZE)
      stop

    if next is in blockedCells
      stop

    if next is in occupiedCells
      stop

    if canonical edge(current, next) is in blockedEdges
      stop

    current = next

  moved = current differs from start

  if not moved
    return { moved: false, from: start, to: start, robots }

  nextRobots = copy of robots with robotId set to current
  
  return { moved: true, from: start, to: current, robots: nextRobots }
```

Wall lookup must canonicalize the current/next pair into the same row-major order required by `BlockedEdge`. This makes a single stored edge block travel in both directions.

The operation assumes a board and robot set that have already passed T02 validation. It should not call `validateBoard` or `validateGameState` internally, because repeated runtime validation would mix boundary validation with the hot-path rules operation. Later server commands remain responsible for runtime payload validation and authorization before calling the engine.

For a no-op, returning the original readonly `RobotPositions` value is safe and avoids an unnecessary allocation. For a real move, return a new record and leave the board, original record, and all original coordinates unchanged.

## 4. Functions and interfaces to introduce

Public additions:

```ts
export const DIRECTIONS = ['up', 'right', 'down', 'left'] as const;

export type Direction = (typeof DIRECTIONS)[number];

export interface MoveResult {
  readonly moved: boolean;
  readonly from: Coordinate;
  readonly to: Coordinate;
  readonly robots: RobotPositions;
}

export function moveRobot(
  board: Board,
  robots: RobotPositions,
  robotId: RobotId,
  direction: Direction,
): MoveResult;
```

`moved` is the authoritative signal for whether T04 should add an entry to move history. `from` and `to` make results easy to inspect, animate, and test without recomputing a diff. A discriminated union is not necessary because the simple invariant `moved === false` implies equal `from` and `to`.

Private helpers in the movement module may include:

- `coordinateKey(coordinate)` for blocked-cell and occupied-cell lookup.
- `edgeKey(first, second)` to normalize an adjacent pair into row-major order.
- `isInBounds(coordinate)` for implicit board boundaries.
- `DIRECTION_DELTAS`, an exhaustive mapping from `Direction` to row/column deltas.

These helpers should remain private for T03. Do not refactor validation helpers into a shared utility until more than the two modules genuinely need a common abstraction.

## 5. Files to create or modify

- Create `packages/game-engine/src/movement.ts`
  - Define `MoveResult`, private lookup helpers, direction deltas, and `moveRobot`.
- Create `packages/game-engine/src/movement.test.ts`
  - Add deterministic fixtures and focused movement tests.
- Modify `packages/game-engine/src/model.ts`
  - Add `DIRECTIONS` and the `Direction` type alongside the existing domain constants and types.
- Modify `packages/game-engine/src/index.ts`
  - Export `DIRECTIONS`, `Direction`, `MoveResult`, and `moveRobot`.
- Modify `packages/game-engine/README.md`
  - Add a concise description of sliding behavior, no-op semantics, and the valid-input assumption.

No changes are planned for `validation.ts`, the web app, server code, workspace configuration, product requirements, architecture, or the main development plan.

## 6. Edge cases and unit tests

Use small explicit boards based on the required center blockage. Keep each test focused on one rule and use table-driven cases where the same behavior must hold in all four directions.

Required tests:

1. **Boundary stops in all four directions**
   - With no nearer obstacle, the selected robot ends at row 0, column 15, row 15, or column 0 as appropriate.
2. **Wall stops**
   - A wall immediately adjacent to the robot produces a no-op.
   - A wall farther along the path stops the robot in the cell immediately before it.
   - The same undirected horizontal or vertical edge blocks travel from either side.
3. **Blocked-cell stops**
   - Approaching the central 2×2 area from each side stops before the first blocked cell.
   - The robot cannot pass across the blocked center.
4. **Robot collision stops**
   - A robot immediately adjacent in the chosen direction produces a no-op.
   - A robot farther away causes the mover to stop in the preceding cell.
   - With multiple robots on the same line, the nearest robot is the effective obstacle; no robot is moved or passed through.
5. **Obstacle selection**
   - When different obstacle types lie along the route, the nearest obstacle wins.
   - Robots and walls that are not on the movement line do not affect the result.
6. **No-op result semantics**
   - Boundary-, wall-, blocked-cell-, and robot-blocked inputs return `moved: false`, equal `from` and `to`, and unchanged positions.
7. **Successful result semantics**
   - Returns `moved: true`, the correct `from` and `to`, and a new positions record in which only the selected robot changed.
8. **Immutability**
   - Frozen input fixtures do not cause writes.
   - The original board, walls, blocked cells, robot record, and coordinates remain deeply equal to their pre-call values.
9. **Determinism**
   - Repeating a move from structurally identical inputs produces structurally identical results.

Invalid coordinates, malformed walls, missing robots, overlapping robots, and robots starting in blocked cells remain T02 validation concerns. T03 movement tests should not define behavior for invalid engine state.

## 7. Technical risks or unresolved questions

There are no blocking product or architecture questions for T03.

- **Valid-input boundary:** `moveRobot` will assume validated engine data. Calling it with arbitrary JavaScript values is unsupported. This is consistent with keeping runtime network validation at the server boundary, but the assumption must be documented.
- **Lookup duplication:** Movement and validation will each have private coordinate/edge key helpers. The duplication is small and preferable to an unrelated T03 refactor. If later geometry modules also need them, a focused shared-helper task can consolidate them.
- **No-op identity:** The proposed no-op result reuses the readonly input positions reference. Consumers must use `moved`, not reference inequality, to count moves. Document and test this behavior if implementation adopts it.
- **Performance:** Per-call sets are intentionally simple. At most 15 movement steps makes this adequate for interactive play. Solver performance must be benchmarked separately in T09 before deciding whether indexed board geometry is needed.
- **Result scope:** T03 does not report which obstacle stopped the robot. That metadata is not required by current product behavior or T04, so adding it now would be speculative.

## 8. Ordered implementation steps

1. Add `DIRECTIONS` and `Direction` to `model.ts` and export them from `index.ts`.
2. Create `movement.test.ts` with boundary, wall, blocked-cell, collision, no-op, immutability, and determinism cases. Confirm the tests fail because the movement API does not yet exist.
3. Create `movement.ts` with private key/bounds helpers and an exhaustive direction-delta mapping.
4. Implement the cell-by-cell scan and no-op result without target or attempt-history logic.
5. Export `moveRobot` and `MoveResult` from `index.ts`.
6. Run the engine unit tests and type check; fix only T03-related failures.
7. Update the game-engine README with the public movement contract and valid-input assumption.
8. Re-run the engine tests and type check, inspect the diff for accidental scope expansion, and report results without starting T04.

