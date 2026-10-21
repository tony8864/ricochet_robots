# Game engine data model

This package contains pure, deterministic TypeScript game rules. It has no
browser, React, networking, timer, or Cloudflare dependencies.

## Coordinates

The board is a fixed 16 by 16 grid. Coordinates are zero-based integer
`{ row, column }` pairs:

- `(0, 0)` is the top-left cell.
- `row` increases downward; `column` increases to the right.
- Both values range from `0` through `15`, inclusive.
- The central 2 by 2 blocked area is `(7,7)`, `(7,8)`, `(8,7)`, and `(8,8)`.

Outer board boundaries are implicit barriers. Blocked cells are also implicit
barriers on every edge, so walls touching blocked cells are not stored.

## Walls

An interior wall is one undirected `BlockedEdge` between two orthogonally
adjacent cells. It is stored once, with `first` before `second` in row-major
order. For example, the wall between `(2,3)` and `(2,4)` is:

```ts
{
  first: { row: 2, column: 3 },
  second: { row: 2, column: 4 },
}
```

Because the edge is a single undirected value, a wall cannot disagree when
viewed from its two neighboring cells. Validation rejects reversed, duplicate,
non-adjacent, out-of-bounds, and blocked-cell edges.

## State

`RobotPositions` has exactly one coordinate for each stable robot ID: `red`,
`blue`, `green`, and `yellow`. A `Target` is either colored (and names the
required robot) or wildcard. `Board`, `RobotPositions`, targets, and `GameState`
expose only readonly properties and arrays.

Colored targets require a `symbol` of `star`, `crescent`, `triangle`, or `square`.
Wildcard targets require `symbol: 'vortex'` and do not specify a `robotId`.
Symbols distinguish target identities visually; they do not affect which robot
can complete a target. A full production board supplies the 16 color/symbol
combinations and one vortex. Collection completeness belongs to catalog
validation; `GameState.target` represents one active target.

Use `validateBoard` or `validateGameState` for structured validation results,
the `isValid...` helpers as type guards, or `assertValid...` to throw on invalid
data.

## Sliding movement

`moveRobot(board, robots, robotId, direction)` slides one robot in `up`,
`right`, `down`, or `left` until the next cell would cross the board boundary or
a wall, enter a blocked cell, or overlap another robot. The result includes the
start and final coordinates, updated readonly robot positions, and a `moved`
flag that callers can use for move counting.

A blocked direction returns `moved: false` and reuses the original
`RobotPositions` value. A successful move returns a new positions record and
does not mutate the board or input positions. The operation assumes its board
and robot inputs have already passed the package validation helpers.

## Target completion and attempts

`isTargetComplete(robots, target)` compares coordinates by value. A colored
target requires its named robot, while a wildcard target accepts any robot.
The predicate is positional, so callers selecting targets must avoid revealing
a target that is already satisfied if zero-move rounds are not desired.

`createAttempt(roundStartRobots)` creates a pure demonstration state with a
stable reset anchor, current robot positions, and an empty move history.
`moveAttemptRobot` delegates sliding to `moveRobot` and records only successful
non-no-op moves. `undoAttempt` removes the latest retained move, and
`resetAttempt` restores every robot to the round-start positions. Undo and
reset are free; `getAttemptMoveCount` derives the current count from retained
history, so discarded moves do not count.

Like the lower-level movement operation, attempt operations assume validated
board, robot, and target inputs. They return new state for changes and do not
mutate their inputs; no-op moves, empty undo, and reset of an untouched attempt
reuse the original attempt value.
