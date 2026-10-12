package io.github.tony8864.engine;

import java.util.EnumSet;


public class Board {

    private final int width;
    private final int height;

    private final EnumSet<Direction>[][] walls;
    private final boolean[][] blocked;

    @SuppressWarnings("unchecked")
    public Board(int width, int height) {

        // 1. init dimensions
        if (width <= 0 || height <= 0) {
            throw new IllegalArgumentException("Width and height must be positive");
        }

        this.width = width;
        this.height = height;

        // 2. init walls
        walls = new EnumSet[width][height];
        for (int x = 0; x < width; x++){
            for (int y = 0; y < height; y ++) {
                walls[x][y] = EnumSet.noneOf(Direction.class);
            }
        }

        // 3. init blocked
        blocked = new boolean[width][height];
    }

    public int width() {
        return width;
    }

    public int height() {
        return height;
    }

    public boolean contains(Position position) {
        return  0 <= position.x() &&
                0 <= position.y() &&
                position.x() < width &&
                position.y() < height;
    }

    public boolean hasWall(Position position, Direction direction) {
        rejectOutsidePosition(position);
        rejectBlockedPosition(position);

        Position neighbor = getNeighbor(position, direction);

        if (!isPlayable(neighbor)) {
            return true;
        }

        return walls[position.x()][position.y()].contains(direction);
    }

    public void addWall(Position position, Direction direction) {
        rejectOutsidePosition(position);

        walls[position.x()][position.y()].add(direction);

        Position neighbor = getNeighbor(position, direction);

        if (!isOutsideTheBoard(neighbor)) {
            walls[neighbor.x()][neighbor.y()].add(direction.opposite());
        }
    }

    public void blockCell(Position position) {
        rejectOutsidePosition(position);
        blocked[position.x()][position.y()] = true;
    }

    public boolean isPlayable(Position position) {
        return contains(position) && !blocked[position.x()][position.y()];
    }

    private void rejectOutsidePosition(Position position) {
        if (isOutsideTheBoard(position)) {
            throw new IllegalArgumentException(
                    "Position (" + position.x() + ", " + position.y() + ") is outside the board"
            );
        }
    }

    private void rejectBlockedPosition(Position position) {
        if (blocked[position.x()][position.y()]) {
            throw new IllegalArgumentException(
                    "Position (" + position.x() + ", " + position.y() + ") is blocked"
            );
        }
    }

    private Position getNeighbor(Position position, Direction direction) {
        return new Position(
                position.x() + direction.getDx(),
                position.y() + direction.getDy()
        );
    }

    private boolean isOutsideTheBoard(Position position) {
        return !contains(position);
    }
}
