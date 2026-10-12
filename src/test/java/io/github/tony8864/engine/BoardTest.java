package io.github.tony8864.engine;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;

import static org.junit.jupiter.api.Assertions.*;

class BoardTest {

    @ParameterizedTest
    @CsvSource({"0, 3", "5, 0", "-1, 3", "5, -1", "0, 0"})
    void rejectsNonPositiveDimensions(int width, int height) {
        assertThrows(IllegalArgumentException.class, () -> new Board(width, height));
    }

    @Test
    void retainsRectangularDimensions() {
        Board board = new Board(5, 3);

        assertEquals(5, board.width());
        assertEquals(3, board.height());
    }

    @ParameterizedTest
    @CsvSource({
            "0, 0, true", "4, 2, true", "4, 0, true", "0, 2, true",
            "-1, 0, false", "0, -1, false", "5, 0, false", "0, 3, false"
    })
    void checksBoundsAndInitialPlayability(int x, int y, boolean expected) {
        Board board = new Board(5, 3);
        Position position = new Position(x, y);

        assertEquals(expected, board.contains(position));
        assertEquals(expected, board.isPlayable(position));
    }

    @ParameterizedTest
    @CsvSource({
            "0, 0, UP", "0, 0, LEFT",
            "4, 2, RIGHT", "4, 2, DOWN"
    })
    void boardEdgesActAsWalls(int x, int y, Direction direction) {
        Board board = new Board(5, 3);

        assertTrue(board.hasWall(new Position(x, y), direction));
    }

    @ParameterizedTest
    @EnumSource(Direction.class)
    void interiorCellsInitiallyHaveNoWalls(Direction direction) {
        Board board = new Board(5, 3);

        assertFalse(board.hasWall(new Position(2, 1), direction));
    }

    @ParameterizedTest
    @CsvSource({"UP, 2, 0, DOWN", "DOWN, 2, 2, UP",
            "LEFT, 1, 1, RIGHT", "RIGHT, 3, 1, LEFT"})
    void addedWallBlocksBothSidesOnly(Direction direction, int neighborX,
                                     int neighborY, Direction opposite) {
        Board board = new Board(5, 3);
        Position origin = new Position(2, 1);
        Position neighbor = new Position(neighborX, neighborY);

        board.addWall(origin, direction);

        assertTrue(board.hasWall(origin, direction));
        assertTrue(board.hasWall(neighbor, opposite));
        for (Direction other : Direction.values()) {
            if (other != direction) {
                assertFalse(board.hasWall(origin, other), "Unexpected wall: " + other);
            }
        }
        assertFalse(board.hasWall(new Position(0, 1), Direction.RIGHT));
    }

    @Test
    void addingSameWallTwiceIsHarmless() {
        Board board = new Board(5, 3);
        Position position = new Position(2, 1);

        board.addWall(position, Direction.RIGHT);
        board.addWall(position, Direction.RIGHT);

        assertTrue(board.hasWall(position, Direction.RIGHT));
        assertTrue(board.hasWall(new Position(3, 1), Direction.LEFT));
    }

    @ParameterizedTest
    @CsvSource({"0, 0, UP", "0, 0, LEFT", "4, 2, RIGHT", "4, 2, DOWN"})
    void addingEdgeWallDoesNotAccessAnOutsideCell(int x, int y, Direction direction) {
        Board board = new Board(5, 3);
        Position position = new Position(x, y);

        assertDoesNotThrow(() -> board.addWall(position, direction));
        assertTrue(board.hasWall(position, direction));
    }

    @Test
    void blockedCellIsInsideButNotPlayable() {
        Board board = new Board(5, 3);
        Position position = new Position(2, 1);

        board.blockCell(position);
        board.blockCell(position);

        assertTrue(board.contains(position));
        assertFalse(board.isPlayable(position));
        assertTrue(board.isPlayable(new Position(3, 1)));
        assertTrue(board.isPlayable(new Position(2, 0)));
    }

    @ParameterizedTest
    @CsvSource({"2, 0, DOWN", "2, 2, UP", "1, 1, RIGHT", "3, 1, LEFT"})
    void blockedCellActsAsWallFromEverySide(int x, int y, Direction direction) {
        Board board = new Board(5, 3);
        board.blockCell(new Position(2, 1));

        assertTrue(board.hasWall(new Position(x, y), direction));
        assertFalse(board.hasWall(new Position(0, 1), Direction.RIGHT));
    }

    @ParameterizedTest
    @EnumSource(Direction.class)
    void wallQueryRejectsBlockedStartingCell(Direction direction) {
        Board board = new Board(5, 3);
        Position position = new Position(2, 1);
        board.blockCell(position);

        assertThrows(IllegalArgumentException.class, () -> board.hasWall(position, direction));
    }

    @ParameterizedTest
    @CsvSource({"-1, 0", "0, -1", "5, 0", "0, 3"})
    void wallOperationsAndBlockingRejectOutsidePositions(int x, int y) {
        Board board = new Board(5, 3);
        Position position = new Position(x, y);

        assertThrows(IllegalArgumentException.class, () -> board.hasWall(position, Direction.RIGHT));
        assertThrows(IllegalArgumentException.class, () -> board.addWall(position, Direction.RIGHT));
        assertThrows(IllegalArgumentException.class, () -> board.blockCell(position));
        assertFalse(board.hasWall(new Position(2, 1), Direction.RIGHT));
        assertTrue(board.isPlayable(new Position(2, 1)));
    }
}
