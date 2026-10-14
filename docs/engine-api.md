# Shared engine API

Package: `io.github.tony8864.engine`. The engine handles board geometry, robot movement, replay, and solution validation. Swing, networking, rounds, timers, bidding order, and scoring belong outside this package. Rule policies are recorded in [game-rules.md](game-rules.md).

## Coordinates and value types

Coordinates start at `(0, 0)` in the top-left corner. `x` increases to the right; `y` increases downward.

| Type | Purpose |
| --- | --- |
| `Position(int x, int y)` | Immutable cell coordinates; equality compares coordinates. Bounds depend on the board. |
| `Direction` | `UP`, `DOWN`, `LEFT`, `RIGHT`; `getDx()` and `getDy()` give coordinate offsets, and `opposite()` gives the reverse direction. |
| `Robot` | `RED`, `GREEN`, `BLUE`, `YELLOW`, `BLACK`. |
| `Move(Robot robot, Direction direction)` | One slide command. Null components are rejected with `IllegalArgumentException`. |
| `TargetType` | Sixteen colored targets: each of `RED`, `GREEN`, `BLUE`, and `YELLOW` combined with `PLANET`, `GEAR`, `STAR`, or `MOON` (for example, `RED_PLANET`), plus `VORTEX`. `getShape()` returns the target's `TargetShape`. `accepts(robot)` accepts only the matching robot for colored targets and any of the five robots for the vortex; null is rejected with `IllegalArgumentException`. Black has no colored target. |
| `TargetShape` | `PLANET`, `GEAR`, `STAR`, `MOON`, and `VORTEX_SHAPE`. Describes the target symbol; shape does not change robot eligibility or movement rules. `VORTEX` uses `VORTEX_SHAPE`. |
| `Target(TargetType targetType, Position position)` | An objective; exposes `targetType()` and `position()`. Rejects null components. Board playability is checked during validation. |

## Board setup and freezing

Create `Board(width, height)` with positive dimensions, then configure geometry:

- `addWall(position, direction)` records a wall on both sides of the shared edge when a neighbor exists. Repeated additions are harmless.
- `blockCell(position)` makes a cell unusable. Configure the center explicitly; no layout or center cells are generated automatically.
- Board edges and blocked neighbors automatically act as walls. Diagonal barriers are not supported.
- `contains(position)` checks bounds, including blocked cells. `isPlayable(position)` additionally excludes blocked cells and returns false outside the board.
- `hasWall(position, direction)` checks the obstruction ahead. Its starting position must be inside and playable; otherwise it throws `IllegalArgumentException`.

`freeze()` permanently prevents geometry changes and is safe to call repeatedly. A successfully constructed `GameState` freezes its board automatically. Failed state construction does not freeze an otherwise configurable board. After freezing, `addWall()` and `blockCell()` throw `IllegalStateException`; queries remain available.

## Game state and simulation

`GameState(board, positions)` requires a non-null board and map, one non-null playable position for every robot, and no overlapping robots. Invalid setup throws `IllegalArgumentException`. The state copies the supplied map, so later map edits cannot change it.

| Method | Behavior |
| --- | --- |
| `positionOf(robot)` | Returns the current position; rejects a null robot. |
| `isOccupied(position)` | Checks whether any robot occupies the cell using coordinate equality. It does not check board bounds; null returns false. |
| `isPlayable(position)` | Delegates to board geometry, regardless of robot occupancy; rejects null. |
| `move(robot, direction)` | Mutates this state and returns the destination. Slides until a wall, board edge, blocked cell, or robot prevents further movement. Null arguments are rejected. Immediate blocking leaves the position unchanged. |
| `copy()` | Returns an independent robot-position map sharing the same frozen board. Copies current positions, not the original setup. |
| `replay(moves)` | Copies this state, executes the commands in order, and returns the resulting copy. Rejects a null list or entries. An empty list returns an unchanged copy. |

Replay simulates commands without checking target success, bids, required turns, or commands producing no movement. Keep the authoritative round-start state separate from local exploration. Game states are mutable; give each independent simulation its own copy rather than sharing one state across concurrent operations.

## Solution validation

Call `new SolutionValidator().validate(start, target, bid, moves)`. Validation uses a working copy and leaves the starting state and submitted list unchanged. Reusing the validator does not retain direction history or positions from earlier calls.

Checks occur in this order:

1. Malformed inputs throw `IllegalArgumentException`: null state/target/list/entries, negative bid, or an unplayable target position. All list entries are checked before bid comparison.
2. `BID_COUNT_MISMATCH`: sequence length differs from the exact bid, including helper commands.
3. `NO_MOVEMENT`: any command fails to change its robot's position.
4. `TARGET_NOT_REACHED`: no eligible robot occupies the target after the entire sequence.
5. `REQUIRED_TURN_MISSING`: the eligible robot on the target never changed between horizontal and vertical slide directions during this sequence.
6. `VALID`: all checks pass.

Each robot's direction history is separate; intervening helper moves do not reset it. A 180° reversal does not qualify. A target occupied at the start gives no automatic success. Zero is an accepted bid input, but an empty sequence cannot satisfy the required turn. Validation evaluates the final position, even if the robot visited the target earlier.

## Usage example

This small synthetic board demonstrates a helper providing the stopping obstacle. It is not a published board layout. The route is covered by `EngineIntegrationTest.movedHelperCreatesStopNeededToSolveTarget`.

```java
import io.github.tony8864.engine.*;
import java.util.List;
import java.util.Map;

public class EngineExample {
    public static void main(String[] args) {
        Board board = new Board(7, 5);
        board.addWall(new Position(4, 3), Direction.DOWN);
        board.addWall(new Position(1, 3), Direction.DOWN);

        GameState start = new GameState(board, Map.of(
                Robot.RED, new Position(1, 1),
                Robot.BLACK, new Position(4, 0),
                Robot.GREEN, new Position(0, 0),
                Robot.BLUE, new Position(6, 0),
                Robot.YELLOW, new Position(0, 4)
        )); // Board is now frozen.

        // Local exploration changes only this copy.
        GameState local = start.copy();
        local.move(Robot.RED, Direction.DOWN);

        Target target = new Target(TargetType.RED_PLANET, new Position(3, 3));
        List<Move> solution = List.of(
                new Move(Robot.BLACK, Direction.DOWN), // Stops at (4, 3).
                new Move(Robot.RED, Direction.DOWN),   // Stops at (1, 3).
                new Move(Robot.RED, Direction.RIGHT)   // Stops at (3, 3), before black.
        );

        ValidationResult result = new SolutionValidator()
                .validate(start, target, 3, solution);
        System.out.println(result); // VALID

        if (result == ValidationResult.VALID) {
            GameState demonstrated = start.replay(solution);
            System.out.println(demonstrated.positionOf(Robot.RED)); // Position[x=3, y=3]
        }
        System.out.println(start.positionOf(Robot.RED)); // Position[x=1, y=1]
    }
}
```

The caller decides when an accepted replay becomes the next round's starting state. The engine does not award points or advance rounds. Board layout selection/generation and the remaining online policies in `game-rules.md` still need separate work.
