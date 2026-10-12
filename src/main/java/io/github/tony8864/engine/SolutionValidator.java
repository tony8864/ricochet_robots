package io.github.tony8864.engine;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;

public class SolutionValidator {

    public ValidationResult validate(
            GameState start,
            Target target,
            int bid,
            List<Move> moves
    ) {
        validateInputs(start, target, bid, moves);

        if (moves.size() != bid) {
            return ValidationResult.BID_COUNT_MISMATCH;
        }

        GameState copy = start.copy();
        EnumMap<Robot, Direction> previousDirections = new EnumMap<>(Robot.class);
        EnumSet<Robot> turned = EnumSet.noneOf(Robot.class);

        Robot robot;
        Position currentPosition;
        Position nextPosition;
        Direction previousDirection;
        Direction currentDirection;

        for (Move move : moves) {
            robot = move.robot();
            currentDirection = move.direction();

            currentPosition = copy.positionOf(robot);
            nextPosition = copy.move(robot, move.direction());

            if (currentPosition.equals(nextPosition)) {
                return ValidationResult.NO_MOVEMENT;
            }

            previousDirection = previousDirections.get(robot);

            if (previousDirection != null) {
                boolean previousIsHorizontal = previousDirection.getDx() != 0;
                boolean currentIsHorizontal = currentDirection.getDx() != 0;

                if (previousIsHorizontal != currentIsHorizontal) {
                    turned.add(robot);
                }
            }

            previousDirections.put(robot, currentDirection);
        }

        Robot targetRobot = null;
        for (Robot r : Robot.values()) {
            boolean isCorrectRobot = target.targetType().accepts(r);
            boolean isOnTargetTile = target.position().equals(copy.positionOf(r));

            if (isCorrectRobot && isOnTargetTile) {
                targetRobot = r;
                break;
            }
        }

        if (targetRobot == null) {
            return ValidationResult.TARGET_NOT_REACHED;
        }

        if (!turned.contains(targetRobot)) {
            return ValidationResult.REQUIRED_TURN_MISSING;
        }

        return ValidationResult.VALID;
    }

    private void validateInputs(
            GameState start,
            Target target,
            int bid,
            List<Move> moves
    ) {
        if (start == null) {
            throw new IllegalArgumentException(
                    "Start game state cannot be null"
            );
        }

        if (bid < 0) {
            throw new IllegalArgumentException(
                    "Negative bid is not allowed"
            );
        }

        if (target == null) {
            throw new IllegalArgumentException(
                    "Target cannot be null"
            );
        }

        if (!start.isPlayable(target.position())) {
            throw new IllegalArgumentException(
                    "Target position is not playable"
            );
        }

        if (moves == null) {
            throw new IllegalArgumentException(
                    "Moves list cannot be null"
            );
        }

        for (Move move : moves) {
            if (move == null) {
                throw new IllegalArgumentException(
                        "Move entry cannot be null"
                );
            }
        }
    }
}
