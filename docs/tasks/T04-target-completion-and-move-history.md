# T04 — Target Completion and Move History Implementation Plan

## 1. Goal and acceptance criteria

Implement pure game-engine operations for target completion and a reusable
demonstration-attempt model. An attempt begins from the official robot
positions at the start of a round, applies T03 sliding moves, records only
successful non-no-op moves, supports free undo and reset, and exposes the
current move count. Target completion must require the matching robot for a
colored target and allow any robot for a wildcard target.

T04 covers engine state only. Bid limits, player authorization, demonstration
turns, success commitment, failure rollback between bidders, scores, timers,
networking, and UI remain outside this task.

T04 is accepted when:

- A colored target is complete only when its specified robot occupies the
  target coordinate.
- A wildcard target is complete when any one of the four robots occupies the
  target coordinate.
- An attempt preserves immutable round-start positions separately from its
  current positions.
- A successful T03 move appends exactly one history entry and increases the
  current move count by one.
- A T03 no-op does not append history, change positions, or increase the move
  count.
- Undo reverses only the most recent recorded move and removes it from the
  current sequence.
- Reset restores all four robots to round-start positions and clears the
  current sequence.
- Undo and reset do not themselves count as moves.
- Discarded moves do not remain in the current history or move count.
- All operations are deterministic and leave their input board, robot
  positions, attempt state, and history unchanged.
- Unit tests cover colored and wildcard target matching, no-op counting,
  multi-robot histories, LIFO undo, reset, empty-history behavior,
  determinism, and frozen-input immutability.
- The public API is exported from the game-engine package and documented
  briefly.
- `pnpm --filter @robot-puzzle/game-engine test` and
  `pnpm --filter @robot-puzzle/game-engine typecheck` pass.
- The implementation has no React, browser, Cloudflare, timer, or networking
  dependency.

## 2. Relevant existing code and types

The current engine already provides the required geometry and movement rules:

- `packages/game-engine/src/model.ts`
  - `Coordinate` is the immutable zero-based row/column position type.
  - `Board` contains immutable blocked cells and canonical blocked edges.
  - `RobotId` identifies `red`, `blue`, `green`, and `yellow`.
  - `ROBOT_IDS` supplies an exhaustive runtime list of those IDs.
  - `RobotPositions` is a readonly record with one coordinate per robot.
  - `ColoredTarget` contains `kind: 'colored'`, a target position, and the
    required `robotId`.
  - `WildcardTarget` contains `kind: 'wildcard'` and a target position.
  - `Target` is the colored/wildcard discriminated union.
  - `Direction` is the four-value cardinal-direction union.
- `packages/game-engine/src/movement.ts`
  - `moveRobot(board, robots, robotId, direction)` applies the complete T03
    sliding rule.
  - A successful result has `moved: true`, `from`, `to`, and a new
    `RobotPositions` record.
  - A no-op result has `moved: false` and reuses the original positions record.
  - Movement assumes its board and positions have already passed T02
    validation and does not mutate inputs.
- `packages/game-engine/src/validation.ts`
  - Validates board, robot, and target data at a boundary before pure engine
    operations are used.
  - T04 should keep the same valid-input assumption rather than repeat runtime
    validation for every attempt operation.
- `packages/game-engine/src/index.ts`
  - Is the public package export surface and must export the T04 API.
- `packages/game-engine/src/movement.test.ts`
  - Establishes deterministic movement fixtures and verifies no-op identity
    and movement immutability.
- `packages/game-engine/README.md`
  - Documents the data model and movement contract. Add a concise attempt and
    target-completion section during implementation.

The attempt model should accept `Board` only when applying a move. It should
not contain a target, bid, player, timer, or match phase. Keeping target
completion as a separate predicate makes both pieces reusable by the future
local match state machine, authoritative room logic, and solver tooling.

## 3. Proposed movement and attempt algorithm, with pseudocode

### Target completion

Target completion is a pure positional predicate:

```text
function isTargetComplete(robots, target)
  if target.kind is colored
    return robots[target.robotId] equals target.position

  for each robotId in ROBOT_IDS
    if robots[robotId] equals target.position
      return true

  return false
```

Coordinate comparison must use row and column values rather than object
identity.

### Attempt creation

```text
function createAttempt(roundStartRobots)
  return
    roundStartRobots = roundStartRobots
    robots = roundStartRobots
    moves = empty readonly array
```

The two position fields may initially reuse the same readonly value. Later
moves replace only `robots`; `roundStartRobots` remains the reset anchor.

### Applying a movement action

```text
function moveAttemptRobot(board, attempt, robotId, direction)
  movement = moveRobot(board, attempt.robots, robotId, direction)

  if movement.moved is false
    return
      moved = false
      attempt = original attempt

  recordedMove =
    robotId = robotId
    direction = direction
    from = movement.from
    to = movement.to

  nextAttempt =
    roundStartRobots = attempt.roundStartRobots
    robots = movement.robots
    moves = attempt.moves followed by recordedMove

  return
    moved = true
    attempt = nextAttempt
```

`moved` from T03 remains the authoritative signal for move counting. No-op
actions return the original attempt and do not allocate a replacement history.

### Undo

Each recorded move changes exactly one robot. Because undo is last-in,
first-out, restoring that robot to the recorded `from` coordinate reconstructs
the previous valid state without replaying the full history.

```text
function undoAttempt(attempt)
  if attempt.moves is empty
    return original attempt

  lastMove = final item in attempt.moves

  return
    roundStartRobots = attempt.roundStartRobots
    robots = copy attempt.robots with lastMove.robotId at lastMove.from
    moves = attempt.moves without its final item
```

### Reset and move count

```text
function resetAttempt(attempt)
  if attempt.moves is empty
    return original attempt

  return
    roundStartRobots = attempt.roundStartRobots
    robots = attempt.roundStartRobots
    moves = empty readonly array

function getAttemptMoveCount(attempt)
  return attempt.moves.length
```

Move count is derived rather than stored, preventing history and count from
disagreeing.

## 4. Functions and interfaces to introduce

Public additions in a new attempt module:

```ts
export interface AttemptMove {
  readonly robotId: RobotId;
  readonly direction: Direction;
  readonly from: Coordinate;
  readonly to: Coordinate;
}

export interface AttemptState {
  readonly roundStartRobots: RobotPositions;
  readonly robots: RobotPositions;
  readonly moves: readonly AttemptMove[];
}

export interface AttemptMoveResult {
  readonly moved: boolean;
  readonly attempt: AttemptState;
}

export function isTargetComplete(
  robots: RobotPositions,
  target: Target,
): boolean;

export function createAttempt(
  roundStartRobots: RobotPositions,
): AttemptState;

export function moveAttemptRobot(
  board: Board,
  attempt: AttemptState,
  robotId: RobotId,
  direction: Direction,
): AttemptMoveResult;

export function undoAttempt(attempt: AttemptState): AttemptState;

export function resetAttempt(attempt: AttemptState): AttemptState;

export function getAttemptMoveCount(attempt: AttemptState): number;
```

Rationale:

- `AttemptMove` stores only the information needed to inspect and reverse one
  accepted move. Full position snapshots per move are unnecessary.
- `AttemptState` keeps the reset anchor, current positions, and current move
  sequence together while remaining independent of multiplayer state.
- `AttemptMoveResult.moved` mirrors T03 and lets callers distinguish accepted
  movement from a no-op without comparing object references.
- A derived move-count function avoids duplicated mutable state.
- `isTargetComplete` remains independent from attempt history because target
  matching depends on robot positions and the active target, not on bids,
  players, or discarded moves.

No bid-limit parameter or success flag belongs in these types. A later match or
room state machine must decide whether a complete target is within a bidder's
limit and when to commit the final positions.

## 5. Files to create or modify

- Create `packages/game-engine/src/attempt.ts`
  - Define the attempt interfaces and pure target, create, move, undo, reset,
    and count operations.
- Create `packages/game-engine/src/attempt.test.ts`
  - Add deterministic fixtures and focused tests for target matching and
    attempt history behavior.
- Modify `packages/game-engine/src/index.ts`
  - Export all new T04 functions and types.
- Modify `packages/game-engine/README.md`
  - Document colored/wildcard matching, successful-move counting, undo/reset,
    and the valid-input assumption.

No changes are planned for `model.ts`, `movement.ts`, `validation.ts`, existing
tests, the web app, server app, shared contracts, puzzle package, workspace
configuration, product requirements, architecture, or the main development
plan during implementation. The main plan's Progress Log should be updated only
after implementation and verification, as required by the implementation
request at that time.

## 6. Edge cases and unit tests

Use a small valid board and deterministic robot fixtures. Tests should exercise
the public API through `packages/game-engine/src/index.ts`.

Required tests:

1. **Colored target matching**
   - Returns true when the required robot occupies the target coordinate.
   - Returns false when a differently colored robot occupies that coordinate.
   - Returns false when no robot occupies the coordinate.
   - Cover each robot ID with table-driven cases so the target's `robotId` is
     always used rather than a hard-coded color.
2. **Wildcard target matching**
   - Returns true when any of the four robots occupies the target coordinate.
   - Returns false when no robot occupies the coordinate.
3. **Attempt creation**
   - Preserves all four round-start positions.
   - Starts with current positions equal to round-start positions, empty
     history, and move count zero.
4. **Successful movement and counting**
   - Uses T03 movement results.
   - Appends one record with the correct robot, direction, `from`, and `to`.
   - Returns a new attempt while leaving the prior attempt unchanged.
   - A sequence involving different robots records the correct order and count.
5. **No-op movement**
   - Boundary-, wall-, blocked-cell-, and robot-blocked actions do not append
     history or increase the count.
   - Returns `moved: false` and the original attempt reference.
6. **Undo**
   - Restores the most recently moved robot to its recorded `from` coordinate.
   - Removes exactly the last history entry and decreases the count by one.
   - Multiple undos proceed in LIFO order and exactly recover round-start
     positions.
   - Undo followed by a different move discards the undone branch from the
     current history and count.
   - Undo on an empty history is a no-op and returns the same attempt.
7. **Reset**
   - Restores all four robots, including robots moved earlier in the sequence.
   - Clears history and returns the count to zero.
   - Reset on an untouched or already-reset attempt is a no-op and returns the
     same attempt.
   - Undo after reset remains a no-op.
8. **Target state through history changes**
   - A valid move can make the appropriate colored or wildcard target complete.
   - Undoing that move makes the target incomplete again.
   - Reset evaluates target completion from the restored round-start positions.
9. **Current-sequence counting**
   - Verify a sequence with moves, undos, replacement moves, and reset counts
     only the currently retained history.
   - Do not add bid-limit behavior; later orchestration owns comparison of this
     count with a bid.
10. **Immutability**
    - Frozen board, round-start positions, current positions, move records, and
      history arrays do not cause writes.
    - Earlier attempt values remain deeply equal to their snapshots after move,
      undo, and reset operations.
11. **Determinism**
    - Repeating identical create/move/undo/reset sequences from structurally
      identical inputs produces structurally identical outputs.

Malformed targets, invalid coordinates, overlapping robots, and invalid boards
remain T02 validation concerns. T04 tests should not define behavior for invalid
engine data.

## 7. Technical risks or unresolved questions

### Product decision to confirm: already-occupied targets

The product says a target is solved when the required robot "stops on" its
target cell. The proposed `isTargetComplete` API is a positional predicate, so
it also returns true if the target is already occupied when an attempt is
created, before any move is recorded.

Recommended interpretation: keep T04 positional and require future target
selection in T10 not to reveal an already-satisfied target. This keeps target
matching deterministic and reusable without coupling it to attempt history.
If zero-move completion must instead be impossible regardless of target
selection, the T04 API would need an explicit accepted-move or history
condition. Confirm this interpretation when approving the plan because it can
affect gameplay.

Other bounded technical considerations:

- **Valid-input boundary:** Attempt functions assume validated boards, robot
  positions, and targets, matching T03. Runtime network validation remains a
  later server-boundary responsibility.
- **Undo representation:** Recording one move's `from` and `to` positions is
  sufficient because moves are undone strictly in reverse order and each move
  changes only one robot. Storing a full four-robot snapshot for every move
  would add memory and duplicated state without changing behavior.
- **No-op identity:** No-op moves, empty undo, and already-reset reset return
  the original immutable attempt. Consumers should use explicit results and
  history length rather than reference inequality for game rules.
- **Success orchestration:** T04 exposes target completion but does not freeze
  an attempt after success. A future authoritative match/room state machine
  must stop accepting demonstration commands and commit positions when success
  is accepted.
- **Bid enforcement:** T04 intentionally does not reject moves at a bid limit.
  Product rules allow undo at the limit, while later authoritative logic owns
  command authorization and limit enforcement.
- **Serialization:** The state consists only of plain readonly objects and
  arrays, making it suitable for later snapshots. No classes, maps, functions,
  timestamps, or runtime-specific values should be stored.

## 8. Ordered implementation steps

1. Confirm the already-occupied-target interpretation described above.
2. Create `attempt.test.ts` with target-matching, attempt creation, no-op,
   history, undo, reset, immutability, and determinism cases. Confirm the tests
   fail because the T04 API does not yet exist.
3. Create `attempt.ts` and implement `isTargetComplete` as a pure positional
   predicate using value-based coordinate comparison.
4. Implement `createAttempt` with immutable round-start positions, current
   positions, and empty history.
5. Implement `moveAttemptRobot` by delegating geometry to T03 `moveRobot` and
   appending history only when `moved` is true.
6. Implement LIFO `undoAttempt` from the final recorded move without replaying
   the full history.
7. Implement `resetAttempt` and derive move count from `moves.length`.
8. Export all T04 functions and types from `index.ts`.
9. Run the focused engine tests and type check; fix only T04-related failures.
10. Update the game-engine README with the target and attempt contracts.
11. Re-run the engine tests and type check, then run workspace tests, workspace
    type checking, and the existing web build to detect integration regressions.
12. Inspect the diff for scope expansion and update the main Progress Log as
    implemented/awaiting review. Do not mark T04 complete, commit, merge, or
    begin the next task until the owner reviews the implementation.
