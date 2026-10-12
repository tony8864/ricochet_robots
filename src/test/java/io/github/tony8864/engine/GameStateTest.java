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

class GameStateTest {

    @Test
    void returnsStartingPositionOfEveryRobot() {
        Map<Robot, Position> positions = validPositions();
        GameState state = new GameState(new Board(5, 3), positions);

        for (Robot robot : Robot.values()) {
            assertEquals(positions.get(robot), state.positionOf(robot), robot.name());
        }
    }

    @Test
    void rejectsNullBoard() {
        assertThrows(IllegalArgumentException.class,
                () -> new GameState(null, validPositions()));
    }

    @Test
    void rejectsNullPositionsMap() {
        assertThrows(IllegalArgumentException.class,
                () -> new GameState(new Board(5, 3), null));
    }

    @Test
    void rejectsEmptyPositionsMap() {
        assertThrows(IllegalArgumentException.class,
                () -> new GameState(new Board(5, 3), Map.of()));
    }

    @ParameterizedTest
    @EnumSource(Robot.class)
    void rejectsMissingRobot(Robot robot) {
        Map<Robot, Position> positions = validPositions();
        positions.remove(robot);

        assertThrows(IllegalArgumentException.class,
                () -> new GameState(new Board(5, 3), positions));
    }

    @ParameterizedTest
    @EnumSource(Robot.class)
    void rejectsNullRobotPosition(Robot robot) {
        Map<Robot, Position> positions = validPositions();
        positions.put(robot, null);

        assertThrows(IllegalArgumentException.class,
                () -> new GameState(new Board(5, 3), positions));
    }

    @ParameterizedTest
    @CsvSource({"-1, 0", "0, -1", "5, 0", "0, 3"})
    void rejectsOutsidePosition(int x, int y) {
        Map<Robot, Position> positions = validPositions();
        positions.put(Robot.RED, new Position(x, y));

        assertThrows(IllegalArgumentException.class,
                () -> new GameState(new Board(5, 3), positions));
    }

    @ParameterizedTest
    @EnumSource(Robot.class)
    void rejectsRobotOnBlockedCell(Robot robot) {
        Board board = new Board(5, 3);
        Map<Robot, Position> positions = validPositions();
        board.blockCell(positions.get(robot));

        assertThrows(IllegalArgumentException.class,
                () -> new GameState(board, positions));
    }

    @Test
    void rejectsTwoRobotsOnSameCell() {
        Map<Robot, Position> positions = validPositions();
        // Separate records with equal coordinates must still count as the same cell.
        positions.put(Robot.GREEN, new Position(0, 0));

        assertThrows(IllegalArgumentException.class,
                () -> new GameState(new Board(5, 3), positions));
    }

    @Test
    void changingSuppliedMapDoesNotChangeStoredPositions() {
        Map<Robot, Position> positions = validPositions();
        Map<Robot, Position> expected = Map.copyOf(positions);
        GameState state = new GameState(new Board(5, 3), positions);

        positions.put(Robot.RED, new Position(2, 2));
        positions.remove(Robot.BLACK);

        for (Robot robot : Robot.values()) {
            assertEquals(expected.get(robot), state.positionOf(robot), robot.name());
        }
    }

    @Test
    void rejectsNullRobotInPositionLookup() {
        GameState state = new GameState(new Board(5, 3), validPositions());

        assertThrows(IllegalArgumentException.class, () -> state.positionOf(null));
    }

    @ParameterizedTest
    @EnumSource(Robot.class)
    void detectsOccupiedCellByCoordinates(Robot robot) {
        Map<Robot, Position> positions = validPositions();
        GameState state = new GameState(new Board(5, 3), positions);
        Position startingPosition = positions.get(robot);

        assertTrue(state.isOccupied(new Position(startingPosition.x(), startingPosition.y())));
    }

    @Test
    void emptyPlayableCellIsNotOccupied() {
        Board board = new Board(5, 3);
        GameState state = new GameState(board, validPositions());
        Position emptyCell = new Position(1, 1);

        assertTrue(board.isPlayable(emptyCell));
        assertFalse(state.isOccupied(emptyCell));
    }

    @Test
    void copyPreservesCurrentPositionsAfterMovement() {
        GameState original = new GameState(new Board(5, 3), validPositions());
        original.move(Robot.BLACK, Direction.RIGHT);

        GameState copy = original.copy();

        assertEquals(new Position(4, 1), copy.positionOf(Robot.BLACK));
        for (Robot robot : Robot.values()) {
            assertEquals(original.positionOf(robot), copy.positionOf(robot));
        }
    }

    @Test
    void movingCopyDoesNotChangeOriginal() {
        Map<Robot, Position> starting = validPositions();
        GameState original = new GameState(new Board(5, 3), starting);
        GameState copy = original.copy();

        assertEquals(new Position(4, 1), copy.move(Robot.BLACK, Direction.RIGHT));

        for (Robot robot : Robot.values()) {
            assertEquals(starting.get(robot), original.positionOf(robot));
        }
        assertTrue(original.isOccupied(new Position(2, 1)));
        assertFalse(original.isOccupied(new Position(4, 1)));
        assertFalse(copy.isOccupied(new Position(2, 1)));
        assertTrue(copy.isOccupied(new Position(4, 1)));
    }

    @Test
    void movingOriginalDoesNotChangeCopy() {
        Map<Robot, Position> starting = validPositions();
        GameState original = new GameState(new Board(5, 3), starting);
        GameState copy = original.copy();

        assertEquals(new Position(0, 1), original.move(Robot.BLACK, Direction.LEFT));

        for (Robot robot : Robot.values()) {
            assertEquals(starting.get(robot), copy.positionOf(robot));
        }
    }

    @Test
    void copyUsesConfiguredWallsAndBlockedCells() {
        Board board = new Board(5, 3);
        board.addWall(new Position(3, 1), Direction.RIGHT);
        board.blockCell(new Position(1, 1));
        GameState original = new GameState(board, validPositions());
        GameState copy = original.copy();

        assertEquals(new Position(3, 1), copy.move(Robot.BLACK, Direction.RIGHT));
        assertEquals(new Position(2, 1), copy.move(Robot.BLACK, Direction.LEFT));
        assertEquals(new Position(2, 1), original.positionOf(Robot.BLACK));
    }

    @Test
    void playableCellsIncludeEmptyAndOccupiedCells() {
        GameState state = new GameState(new Board(5, 3), validPositions());

        assertTrue(state.isPlayable(new Position(1, 1)));
        assertTrue(state.isPlayable(new Position(0, 0)));
        assertTrue(state.isPlayable(new Position(4, 2)));
    }

    @Test
    void blockedCellIsNotPlayableThroughGameState() {
        Board board = new Board(5, 3);
        board.blockCell(new Position(1, 1));
        GameState state = new GameState(board, validPositions());

        assertFalse(state.isPlayable(new Position(1, 1)));
        assertTrue(state.isPlayable(new Position(3, 1)));
    }

    @ParameterizedTest
    @CsvSource({"-1, 0", "0, -1", "5, 0", "0, 3"})
    void outsideCellIsNotPlayableThroughGameState(int x, int y) {
        GameState state = new GameState(new Board(5, 3), validPositions());

        assertFalse(state.isPlayable(new Position(x, y)));
    }

    @Test
    void playabilityQueryRejectsNullPosition() {
        GameState state = new GameState(new Board(5, 3), validPositions());

        assertThrows(IllegalArgumentException.class, () -> state.isPlayable(null));
    }

    private Map<Robot, Position> validPositions() {
        Map<Robot, Position> positions = new HashMap<>();
        positions.put(Robot.RED, new Position(0, 0));
        positions.put(Robot.GREEN, new Position(4, 0));
        positions.put(Robot.BLUE, new Position(0, 2));
        positions.put(Robot.YELLOW, new Position(4, 2));
        positions.put(Robot.BLACK, new Position(2, 1));
        return positions;
    }
}
