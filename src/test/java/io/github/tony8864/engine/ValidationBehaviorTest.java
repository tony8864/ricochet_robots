package io.github.tony8864.engine;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ValidationBehaviorTest {
    private final SolutionValidator validator = new SolutionValidator();

    @Test
    void malformedEntryTakesPrecedenceOverBidMismatchAndBlockedCommand() {
        GameState start = state();
        List<Move> moves = Arrays.asList(new Move(Robot.GREEN, Direction.UP), null);

        assertThrows(IllegalArgumentException.class,
                () -> validator.validate(start, target(6, 3), 1, moves));
        assertStartingPositions(start);
    }

    @Test
    void invalidTargetTakesPrecedenceOverBidMismatch() {
        GameState start = state();

        assertThrows(IllegalArgumentException.class,
                () -> validator.validate(start, target(7, 3), 1, winningMoves()));
        assertStartingPositions(start);
    }

    @Test
    void bidMismatchTakesPrecedenceOverNoMovement() {
        GameState start = state();

        assertEquals(ValidationResult.BID_COUNT_MISMATCH,
                validator.validate(start, target(6, 3), 2,
                        List.of(new Move(Robot.GREEN, Direction.UP))));
        assertStartingPositions(start);
    }

    @Test
    void noMovementTakesPrecedenceOverMissingTargetAndTurn() {
        GameState start = state();

        assertEquals(ValidationResult.NO_MOVEMENT,
                validator.validate(start, target(5, 1), 1,
                        List.of(new Move(Robot.GREEN, Direction.UP))));
        assertStartingPositions(start);
    }

    @Test
    void missingTargetTakesPrecedenceOverMissingTurn() {
        GameState start = state();

        assertEquals(ValidationResult.TARGET_NOT_REACHED,
                validator.validate(start, target(5, 1), 1,
                        List.of(new Move(Robot.RED, Direction.RIGHT))));
        assertStartingPositions(start);
    }

    @Test
    void repeatedWinningSubmissionAlwaysStartsFromSamePositions() {
        GameState start = state();
        List<Move> moves = winningMoves();

        for (int attempt = 0; attempt < 3; attempt++) {
            assertEquals(ValidationResult.VALID,
                    validator.validate(start, target(6, 3), moves.size(), moves));
            assertStartingPositions(start);
        }
        assertEquals(winningMoves(), moves, "Validation must not change the submitted list");
    }

    @Test
    void successfulCallDoesNotLeakTurnFlagIntoNextCall() {
        GameState start = state();
        assertEquals(ValidationResult.VALID,
                validator.validate(start, target(6, 3), 2, winningMoves()));

        assertEquals(ValidationResult.REQUIRED_TURN_MISSING,
                validator.validate(start, target(6, 2), 1,
                        List.of(new Move(Robot.RED, Direction.RIGHT))));
        assertStartingPositions(start);
    }

    @Test
    void previousDirectionDoesNotCarryBetweenSubmissions() {
        GameState start = state();
        assertEquals(ValidationResult.REQUIRED_TURN_MISSING,
                validator.validate(start, target(6, 2), 1,
                        List.of(new Move(Robot.RED, Direction.RIGHT))));

        // This vertical slide must not be paired with the previous submission's horizontal slide.
        assertEquals(ValidationResult.REQUIRED_TURN_MISSING,
                validator.validate(start, target(3, 4), 1,
                        List.of(new Move(Robot.RED, Direction.DOWN))));
        assertStartingPositions(start);
    }

    @Test
    void failureAfterPartialReplayDoesNotLeakPositionsOrTurns() {
        GameState start = state();
        assertEquals(ValidationResult.NO_MOVEMENT,
                validator.validate(start, target(6, 3), 3, List.of(
                        new Move(Robot.RED, Direction.RIGHT),
                        new Move(Robot.RED, Direction.DOWN),
                        new Move(Robot.RED, Direction.DOWN))));
        assertStartingPositions(start);

        assertEquals(ValidationResult.REQUIRED_TURN_MISSING,
                validator.validate(start, target(6, 2), 1,
                        List.of(new Move(Robot.RED, Direction.RIGHT))));
        assertEquals(ValidationResult.VALID,
                validator.validate(start, target(6, 3), 2, winningMoves()));
        assertStartingPositions(start);
    }

    @Test
    void exceptionDoesNotPreventLaterValidSubmission() {
        GameState start = state();
        assertThrows(IllegalArgumentException.class,
                () -> validator.validate(start, target(6, 3), 2,
                        Arrays.asList(new Move(Robot.RED, Direction.RIGHT), null)));

        assertEquals(ValidationResult.VALID,
                validator.validate(start, target(6, 3), 2, winningMoves()));
        assertStartingPositions(start);
    }

    @Test
    void validatorCanBeReusedAcrossDifferentBoardsAndTargets() {
        GameState first = state();
        Board secondBoard = new Board(7, 5);
        secondBoard.addWall(new Position(5, 2), Direction.RIGHT);
        secondBoard.addWall(new Position(5, 3), Direction.DOWN);
        GameState second = new GameState(secondBoard, positions());

        assertEquals(ValidationResult.VALID,
                validator.validate(first, target(6, 3), 2, winningMoves()));
        assertEquals(ValidationResult.VALID,
                validator.validate(second, target(5, 3), 2, winningMoves()));
        assertEquals(ValidationResult.VALID,
                validator.validate(first, target(6, 3), 2, winningMoves()));
        assertStartingPositions(first);
        assertStartingPositions(second);
    }

    private GameState state() {
        return new GameState(new Board(7, 5), positions());
    }

    private Target target(int x, int y) {
        return new Target(TargetType.RED, new Position(x, y));
    }

    private List<Move> winningMoves() {
        return List.of(new Move(Robot.RED, Direction.RIGHT), new Move(Robot.RED, Direction.DOWN));
    }

    private Map<Robot, Position> positions() {
        return Map.of(Robot.RED, new Position(3, 2), Robot.GREEN, new Position(0, 0),
                Robot.BLUE, new Position(6, 0), Robot.YELLOW, new Position(0, 4),
                Robot.BLACK, new Position(6, 4));
    }

    private void assertStartingPositions(GameState state) {
        Map<Robot, Position> expected = positions();
        for (Robot robot : Robot.values()) {
            assertEquals(expected.get(robot), state.positionOf(robot), robot.name());
        }
    }
}
