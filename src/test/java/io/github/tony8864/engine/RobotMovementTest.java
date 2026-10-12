package io.github.tony8864.engine;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RobotMovementTest {

    @ParameterizedTest
    @CsvSource({"UP, 3, 0", "DOWN, 3, 4", "LEFT, 0, 2", "RIGHT, 6, 2"})
    void slidesAllTheWayToBoardEdge(Direction direction, int x, int y) {
        GameState state = new GameState(new Board(7, 5), startingPositions());
        Position expected = new Position(x, y);

        assertEquals(expected, state.move(Robot.RED, direction));
        assertEquals(expected, state.positionOf(Robot.RED));
        assertFalse(state.isOccupied(new Position(3, 2)));
        assertTrue(state.isOccupied(expected));
        assertHelpersUnchanged(state);
    }

    @ParameterizedTest
    @CsvSource({"UP, 3, 1", "DOWN, 3, 3", "LEFT, 1, 2", "RIGHT, 5, 2"})
    void stopsAtInternalWall(Direction direction, int x, int y) {
        Board board = new Board(7, 5);
        Position expected = new Position(x, y);
        board.addWall(expected, direction);
        GameState state = new GameState(board, startingPositions());

        assertEquals(expected, state.move(Robot.RED, direction));
        assertEquals(expected, state.positionOf(Robot.RED));
        assertHelpersUnchanged(state);
    }

    @ParameterizedTest
    @CsvSource({"UP, 3, 0, 3, 1", "DOWN, 3, 4, 3, 3",
            "LEFT, 0, 2, 1, 2", "RIGHT, 6, 2, 5, 2"})
    void stopsBeforeBlockedCell(Direction direction, int blockedX, int blockedY,
                                int destinationX, int destinationY) {
        Board board = new Board(7, 5);
        board.blockCell(new Position(blockedX, blockedY));
        GameState state = new GameState(board, startingPositions());
        Position expected = new Position(destinationX, destinationY);

        assertEquals(expected, state.move(Robot.RED, direction));
        assertEquals(expected, state.positionOf(Robot.RED));
        assertHelpersUnchanged(state);
    }

    @ParameterizedTest
    @CsvSource({"UP, 3, 0, 3, 1", "DOWN, 3, 4, 3, 3",
            "LEFT, 0, 2, 1, 2", "RIGHT, 6, 2, 5, 2"})
    void stopsBeforeAnotherRobot(Direction direction, int blockerX, int blockerY,
                                 int destinationX, int destinationY) {
        Map<Robot, Position> positions = new HashMap<>(startingPositions());
        Position blocker = new Position(blockerX, blockerY);
        positions.put(Robot.BLACK, blocker);
        GameState state = new GameState(new Board(7, 5), positions);
        Position expected = new Position(destinationX, destinationY);

        assertEquals(expected, state.move(Robot.RED, direction));
        assertEquals(expected, state.positionOf(Robot.RED));
        for (Robot robot : Robot.values()) {
            if (robot != Robot.RED) {
                assertEquals(positions.get(robot), state.positionOf(robot));
            }
        }
    }

    @ParameterizedTest
    @EnumSource(Direction.class)
    void immediateWallLeavesAllPositionsUnchanged(Direction direction) {
        Board board = new Board(7, 5);
        Position start = new Position(3, 2);
        board.addWall(start, direction);
        GameState state = new GameState(board, startingPositions());

        assertEquals(start, state.move(Robot.RED, direction));
        assertEquals(start, state.positionOf(Robot.RED));
        assertHelpersUnchanged(state);
    }

    @ParameterizedTest
    @CsvSource({"UP, 3, 1", "DOWN, 3, 3", "LEFT, 2, 2", "RIGHT, 4, 2"})
    void adjacentRobotLeavesMovingRobotInPlace(Direction direction, int x, int y) {
        Map<Robot, Position> positions = new HashMap<>(startingPositions());
        positions.put(Robot.BLACK, new Position(x, y));
        GameState state = new GameState(new Board(7, 5), positions);

        assertEquals(new Position(3, 2), state.move(Robot.RED, direction));
        for (Robot robot : Robot.values()) {
            assertEquals(positions.get(robot), state.positionOf(robot));
        }
    }

    @ParameterizedTest
    @CsvSource({"UP, 3, 1", "DOWN, 3, 3", "LEFT, 2, 2", "RIGHT, 4, 2"})
    void adjacentBlockedCellLeavesRobotInPlace(Direction direction, int x, int y) {
        Board board = new Board(7, 5);
        board.blockCell(new Position(x, y));
        GameState state = new GameState(board, startingPositions());

        assertEquals(new Position(3, 2), state.move(Robot.RED, direction));
        assertEquals(new Position(3, 2), state.positionOf(Robot.RED));
        assertHelpersUnchanged(state);
    }

    @Test
    void repeatedMoveAtEdgeLeavesRobotInPlace() {
        GameState state = new GameState(new Board(7, 5), startingPositions());
        state.move(Robot.RED, Direction.RIGHT);

        assertEquals(new Position(6, 2), state.move(Robot.RED, Direction.RIGHT));
        assertEquals(new Position(6, 2), state.positionOf(Robot.RED));
        assertHelpersUnchanged(state);
    }

    @Test
    void blackRobotCanMoveAndItsNewPositionBlocksOtherRobots() {
        GameState state = new GameState(new Board(7, 5), startingPositions());

        assertEquals(new Position(1, 4), state.move(Robot.BLACK, Direction.LEFT));
        assertFalse(state.isOccupied(new Position(6, 4)));
        assertEquals(new Position(6, 4), state.move(Robot.BLUE, Direction.DOWN));
        assertEquals(new Position(2, 4), state.move(Robot.BLUE, Direction.LEFT));
        assertEquals(new Position(1, 4), state.positionOf(Robot.BLACK));
        assertEquals(new Position(2, 4), state.positionOf(Robot.BLUE));
        assertEquals(new Position(3, 2), state.positionOf(Robot.RED));
        assertEquals(new Position(0, 0), state.positionOf(Robot.GREEN));
        assertEquals(new Position(0, 4), state.positionOf(Robot.YELLOW));
    }

    @Test
    void rejectsNullArgumentsWithoutChangingState() {
        GameState state = new GameState(new Board(7, 5), startingPositions());

        assertThrows(IllegalArgumentException.class, () -> state.move(null, Direction.RIGHT));
        assertThrows(IllegalArgumentException.class, () -> state.move(Robot.RED, null));
        for (Robot robot : Robot.values()) {
            assertEquals(startingPositions().get(robot), state.positionOf(robot));
        }
    }

    private Map<Robot, Position> startingPositions() {
        return Map.of(
                Robot.RED, new Position(3, 2),
                Robot.GREEN, new Position(0, 0),
                Robot.BLUE, new Position(6, 0),
                Robot.YELLOW, new Position(0, 4),
                Robot.BLACK, new Position(6, 4)
        );
    }

    private void assertHelpersUnchanged(GameState state) {
        Map<Robot, Position> positions = startingPositions();
        for (Robot robot : Robot.values()) {
            if (robot != Robot.RED) {
                assertEquals(positions.get(robot), state.positionOf(robot), robot.name());
            }
        }
    }
}
