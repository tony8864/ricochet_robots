package io.github.tony8864.engine;

import java.util.*;

public class GameState {
    private final Board board;
    private final EnumMap<Robot, Position> positions;

    public GameState(Board board, Map<Robot, Position> positions) {
        if (board == null) {
            throw new IllegalArgumentException("Board cannot be null");
        }
        this.board = board;

        validateRobotPositions(positions);
        this.positions = new EnumMap<>(positions);

        board.freeze();
    }

    public GameState copy() {
        return new GameState(board, positions);
    }

    public GameState replay(List<Move> moves) {
        if (moves == null) {
            throw new IllegalArgumentException(
                    "Moves list cannot be null"
            );
        }

        GameState replayed = copy();
        for (Move move : moves) {
            if (move == null) {
                throw new IllegalArgumentException(
                        "Move cannot be null"
                );
            }
            replayed.move(move.robot(), move.direction());
        }

        return replayed;
    }

    public boolean isPlayable(Position position) {
        if (position == null) {
            throw new IllegalArgumentException(
                    "Position cannot be null"
            );
        }
        return board.isPlayable(position);
    }

    public Position positionOf(Robot robot) {
        if (robot == null) {
            throw new IllegalArgumentException("Robot cannot be null");
        }
        return positions.get(robot);
    }

    public boolean isOccupied(Position position) {
        return positions.containsValue(position);
    }

    public Position move(Robot robot, Direction direction) {
        if (robot == null) {
            throw new IllegalArgumentException(
                    "Robot cannot be null"
            );
        }

        if (direction == null) {
            throw new IllegalArgumentException(
                    "Direction cannot be null"
            );
        }

        Position current = positionOf(robot);
        Position next;
        while (!board.hasWall(current, direction)) {
            next = new Position(
                    current.x() + direction.getDx(),
                    current.y() + direction.getDy()
            );

            if (isOccupied(next)) {
                break;
            }

            current = next;
        }

        positions.put(robot, current);
        return current;
    }

    private void validateRobotPositions(Map<Robot, Position> positions) {
        if (positions == null) {
            throw new IllegalArgumentException("Positions map cannot be null");
        }

        Set<Position> seenPositions = new HashSet<>();

        for (Robot robot : Robot.values()) {
            Position position = positions.get(robot);

            if (position == null) {
                throw new IllegalArgumentException(
                        "Missing or null position for robot " + robot.name()
                );
            }

            if (!board.isPlayable(position)) {
                throw new IllegalArgumentException(
                        "Position (" + position.x() + ", " + position.y() + ") is not playable for robot " + robot.name()
                );
            }

            if (!seenPositions.add(position)) {
                throw new IllegalArgumentException(
                        "Duplicate position detected at " + position + " for robot " + robot.name()
                );
            }
        }
    }

}
