package io.github.tony8864.board;

import io.github.tony8864.engine.*;

import java.util.List;

import static io.github.tony8864.engine.Direction.*;

/** Fixed 16-by-16 geometry transcribed from the supplied board photograph. */
public final class TestBoardLayout {
    private TestBoardLayout() {
    }

    public static BoardLayout create() {
        Board board = new Board(16, 16);
        for (int y = 7; y <= 8; y++) {
            for (int x = 7; x <= 8; x++) {
                board.blockCell(new Position(x, y));
            }
        }

        // Short walls extending inward from the outer edge.
        wall(board, 2, 0, RIGHT);
        wall(board, 8, 0, RIGHT);
        wall(board, 15, 1, DOWN);
        wall(board, 15, 9, DOWN);
        wall(board, 11, 15, RIGHT);
        wall(board, 5, 15, RIGHT);
        wall(board, 0, 10, DOWN);
        wall(board, 0, 3, DOWN);

        // Interior corners, using zero-based (x, y) coordinates.
        corner(board, 5, 1, LEFT, DOWN);
        corner(board, 11, 1, UP, LEFT);
        corner(board, 7, 2, RIGHT, DOWN);
        corner(board, 14, 3, UP, RIGHT);
        corner(board, 3, 4, RIGHT, DOWN);
        corner(board, 9, 4, RIGHT, DOWN);
        corner(board, 6, 5, UP, LEFT);
        corner(board, 1, 6, UP, RIGHT);
        corner(board, 12, 6, LEFT, DOWN);
        corner(board, 1, 9, UP, RIGHT);
        corner(board, 5, 9, UP, LEFT);
        corner(board, 8, 10, RIGHT, DOWN);
        corner(board, 13, 11, UP, LEFT);
        corner(board, 6, 12, RIGHT, DOWN);
        corner(board, 9, 13, LEFT, DOWN);
        corner(board, 2, 14, LEFT, DOWN);
        corner(board, 14, 14, UP, RIGHT);

        List<Target> targets = List.of(
                new Target(TargetType.BLUE_GEAR, new Position(5, 1)),
                new Target(TargetType.RED_MOON, new Position(11, 1)),
                new Target(TargetType.VORTEX, new Position(7, 2)),
                new Target(TargetType.GREEN_MOON, new Position(14, 3)),
                new Target(TargetType.RED_STAR, new Position(3, 4)),
                new Target(TargetType.BLUE_MOON, new Position(9, 4)),
                new Target(TargetType.GREEN_MOON, new Position(6, 5)),
                new Target(TargetType.YELLOW_GEAR, new Position(1, 6)),
                new Target(TargetType.YELLOW_MOON, new Position(12, 6)),
                new Target(TargetType.YELLOW_STAR, new Position(1, 9)),
                new Target(TargetType.BLUE_PLANET, new Position(5, 9)),
                new Target(TargetType.YELLOW_PLANET, new Position(8, 10)),
                new Target(TargetType.BLUE_STAR, new Position(13, 11)),
                new Target(TargetType.RED_PLANET, new Position(6, 12)),
                new Target(TargetType.GREEN_PLANET, new Position(9, 13)),
                new Target(TargetType.GREEN_GEAR, new Position(2, 14)),
                new Target(TargetType.RED_GEAR, new Position(14, 14))
        );
        return new BoardLayout(board, targets);
    }

    private static void corner(Board board, int x, int y, Direction first, Direction second) {
        wall(board, x, y, first);
        wall(board, x, y, second);
    }

    private static void wall(Board board, int x, int y, Direction direction) {
        board.addWall(new Position(x, y), direction);
    }
}
