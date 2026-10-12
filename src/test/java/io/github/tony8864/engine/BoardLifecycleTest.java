package io.github.tony8864.engine;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class BoardLifecycleTest {

    @Test
    void freezingPreservesGeometryAndAllowsReads() {
        Board board = new Board(5, 3);
        board.addWall(new Position(2, 1), Direction.RIGHT);
        board.blockCell(new Position(1, 1));

        board.freeze();
        assertDoesNotThrow(board::freeze);

        assertEquals(5, board.width());
        assertEquals(3, board.height());
        assertTrue(board.contains(new Position(1, 1)));
        assertFalse(board.isPlayable(new Position(1, 1)));
        assertTrue(board.isPlayable(new Position(2, 1)));
        assertTrue(board.hasWall(new Position(2, 1), Direction.RIGHT));
        assertTrue(board.hasWall(new Position(3, 1), Direction.LEFT));
        assertTrue(board.hasWall(new Position(2, 1), Direction.LEFT));
    }

    @Test
    void frozenBoardRejectsMutationsWithoutChangingGeometry() {
        Board board = new Board(5, 3);
        board.freeze();

        assertThrows(IllegalStateException.class,
                () -> board.addWall(new Position(2, 1), Direction.RIGHT));
        assertThrows(IllegalStateException.class,
                () -> board.blockCell(new Position(2, 1)));

        assertFalse(board.hasWall(new Position(2, 1), Direction.RIGHT));
        assertFalse(board.hasWall(new Position(3, 1), Direction.LEFT));
        assertTrue(board.isPlayable(new Position(2, 1)));
    }

    @Test
    void validGameStateFreezesBoardButAllowsIndependentMovementAndReplay() {
        Board board = new Board(5, 3);
        GameState original = new GameState(board, positions());
        GameState copy = original.copy();
        GameState other = new GameState(board, positions());

        assertThrows(IllegalStateException.class,
                () -> board.addWall(new Position(2, 1), Direction.RIGHT));
        assertThrows(IllegalStateException.class,
                () -> board.blockCell(new Position(3, 1)));

        assertEquals(new Position(4, 1), copy.move(Robot.BLACK, Direction.RIGHT));
        assertEquals(new Position(0, 1), other.move(Robot.BLACK, Direction.LEFT));
        GameState replayed = original.replay(java.util.List.of(new Move(Robot.BLACK, Direction.RIGHT)));
        assertEquals(new Position(4, 1), replayed.positionOf(Robot.BLACK));
        assertEquals(new Position(2, 1), original.positionOf(Robot.BLACK));
    }

    @Test
    void gameStateCanUseAlreadyFrozenBoard() {
        Board board = new Board(5, 3);
        board.freeze();

        GameState state = assertDoesNotThrow(() -> new GameState(board, positions()));

        assertEquals(new Position(4, 1), state.move(Robot.BLACK, Direction.RIGHT));
    }

    @Test
    void nullPositionsDoNotFreezeBoard() {
        Board board = new Board(5, 3);

        assertThrows(IllegalArgumentException.class, () -> new GameState(board, null));

        assertStillConfigurable(board);
    }

    @ParameterizedTest
    @EnumSource(Robot.class)
    void missingRobotDoesNotFreezeBoard(Robot robot) {
        Board board = new Board(5, 3);
        Map<Robot, Position> positions = positions();
        positions.remove(robot);

        assertThrows(IllegalArgumentException.class, () -> new GameState(board, positions));

        assertStillConfigurable(board);
    }

    @Test
    void duplicatePositionsDoNotFreezeBoard() {
        Board board = new Board(5, 3);
        Map<Robot, Position> positions = positions();
        positions.put(Robot.BLACK, new Position(0, 0));

        assertThrows(IllegalArgumentException.class, () -> new GameState(board, positions));

        assertStillConfigurable(board);
    }

    @Test
    void outsidePositionDoesNotFreezeBoard() {
        Board board = new Board(5, 3);
        Map<Robot, Position> positions = positions();
        positions.put(Robot.BLACK, new Position(5, 1));

        assertThrows(IllegalArgumentException.class, () -> new GameState(board, positions));

        assertStillConfigurable(board);
    }

    @Test
    void blockedPositionDoesNotFreezeBoard() {
        Board board = new Board(5, 3);
        board.blockCell(new Position(2, 1));

        assertThrows(IllegalArgumentException.class, () -> new GameState(board, positions()));

        assertStillConfigurable(board);
    }

    private void assertStillConfigurable(Board board) {
        assertDoesNotThrow(() -> board.addWall(new Position(3, 1), Direction.RIGHT));
        assertDoesNotThrow(() -> board.blockCell(new Position(1, 1)));
        assertTrue(board.hasWall(new Position(3, 1), Direction.RIGHT));
        assertFalse(board.isPlayable(new Position(1, 1)));
    }

    private Map<Robot, Position> positions() {
        return new HashMap<>(Map.of(
                Robot.RED, new Position(0, 0), Robot.GREEN, new Position(4, 0),
                Robot.BLUE, new Position(0, 2), Robot.YELLOW, new Position(4, 2),
                Robot.BLACK, new Position(2, 1)));
    }
}
