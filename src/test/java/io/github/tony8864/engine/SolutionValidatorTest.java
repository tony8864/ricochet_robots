package io.github.tony8864.engine;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SolutionValidatorTest {
    private final SolutionValidator validator = new SolutionValidator();

    @Test
    void acceptsColoredSolutionWithRightAngleTurn() {
        check(ValidationResult.VALID, state(), redTarget(6, 3), List.of(
                move(Robot.RED, Direction.RIGHT), move(Robot.RED, Direction.DOWN)));
    }

    @Test
    void helperBetweenSlidesDoesNotResetSolvingRobotsDirection() {
        check(ValidationResult.VALID, state(), redTarget(6, 3), List.of(
                move(Robot.RED, Direction.RIGHT), move(Robot.GREEN, Direction.RIGHT),
                move(Robot.RED, Direction.DOWN)));
    }

    @Test
    void helperTurnDoesNotQualifySolvingRobot() {
        check(ValidationResult.REQUIRED_TURN_MISSING, state(), redTarget(6, 2), List.of(
                move(Robot.BLACK, Direction.LEFT), move(Robot.BLACK, Direction.UP),
                move(Robot.RED, Direction.RIGHT)));
    }

    @Test
    void directArrivalRequiresTurn() {
        check(ValidationResult.REQUIRED_TURN_MISSING, state(), redTarget(6, 2),
                List.of(move(Robot.RED, Direction.RIGHT)));
    }

    @Test
    void reversalDoesNotCountAsRightAngleTurn() {
        check(ValidationResult.REQUIRED_TURN_MISSING, state(), redTarget(0, 2), List.of(
                move(Robot.RED, Direction.RIGHT), move(Robot.RED, Direction.LEFT)));
    }

    @Test
    void blackRobotCanSolveVortex() {
        check(ValidationResult.VALID, state(), new Target(TargetType.VORTEX, new Position(1, 0)),
                List.of(move(Robot.BLACK, Direction.LEFT), move(Robot.BLACK, Direction.UP)));
    }

    @Test
    void blackRobotCannotSolveColoredTarget() {
        check(ValidationResult.TARGET_NOT_REACHED, state(), redTarget(1, 0),
                List.of(move(Robot.BLACK, Direction.LEFT), move(Robot.BLACK, Direction.UP)));
    }

    @Test
    void rejectsSequenceThatNeverReachesTarget() {
        check(ValidationResult.TARGET_NOT_REACHED, state(), redTarget(5, 1),
                List.of(move(Robot.RED, Direction.RIGHT)));
    }

    @Test
    void reachingTargetEarlyDoesNotSkipLaterNoMovement() {
        check(ValidationResult.NO_MOVEMENT, state(), redTarget(6, 3), List.of(
                move(Robot.RED, Direction.RIGHT), move(Robot.RED, Direction.DOWN),
                move(Robot.RED, Direction.DOWN)));
    }

    @Test
    void robotMustStillBeOnTargetAtEndOfSequence() {
        check(ValidationResult.TARGET_NOT_REACHED, state(), redTarget(6, 3), List.of(
                move(Robot.RED, Direction.RIGHT), move(Robot.RED, Direction.DOWN),
                move(Robot.RED, Direction.LEFT)));
    }

    @Test
    void acceptsHelpersAfterSolvingRobotReachesTarget() {
        check(ValidationResult.VALID, state(), redTarget(6, 3), List.of(
                move(Robot.RED, Direction.RIGHT), move(Robot.RED, Direction.DOWN),
                move(Robot.GREEN, Direction.RIGHT)));
    }

    @Test
    void rejectsImmediatelyBlockedCommand() {
        check(ValidationResult.NO_MOVEMENT, state(), redTarget(6, 3),
                List.of(move(Robot.GREEN, Direction.UP)));
    }

    @ParameterizedTest
    @CsvSource({"1", "3"})
    void bidMustMatchSequenceExactly(int bid) {
        GameState start = state();
        GameState snapshot = start.copy();
        assertEquals(ValidationResult.BID_COUNT_MISMATCH,
                validator.validate(start, redTarget(6, 3), bid, List.of(
                        move(Robot.RED, Direction.RIGHT), move(Robot.RED, Direction.DOWN))));
        assertUnchanged(snapshot, start);
    }

    @Test
    void occupiedTargetWithZeroMovesDoesNotWin() {
        check(ValidationResult.REQUIRED_TURN_MISSING, state(), redTarget(3, 2), List.of());
    }

    @Test
    void occupiedTargetCanBeSolvedByLeavingAndReturningWithTurn() {
        check(ValidationResult.VALID, loopState(0), redTarget(0, 1), List.of(
                move(Robot.RED, Direction.RIGHT), move(Robot.RED, Direction.DOWN),
                move(Robot.RED, Direction.LEFT), move(Robot.RED, Direction.UP)));
    }

    @Test
    void earlyArrivalWithoutTurnDoesNotPreventLaterQualifyingReturn() {
        check(ValidationResult.VALID, loopState(2), redTarget(0, 1), List.of(
                move(Robot.RED, Direction.LEFT), move(Robot.RED, Direction.DOWN),
                move(Robot.RED, Direction.RIGHT), move(Robot.RED, Direction.UP),
                move(Robot.RED, Direction.LEFT)));
    }

    @Test
    void rejectsNullInputsAndNegativeBid() {
        GameState start = state();
        Target target = redTarget(6, 3);
        assertThrows(IllegalArgumentException.class,
                () -> validator.validate(null, target, 0, List.of()));
        assertThrows(IllegalArgumentException.class,
                () -> validator.validate(start, null, 0, List.of()));
        assertThrows(IllegalArgumentException.class,
                () -> validator.validate(start, target, 0, null));
        assertThrows(IllegalArgumentException.class,
                () -> validator.validate(start, target, -1, List.of()));
    }

    @Test
    void rejectsNullMoveEvenAfterPotentialSuccess() {
        GameState start = state();
        GameState snapshot = start.copy();
        List<Move> moves = Arrays.asList(move(Robot.RED, Direction.RIGHT),
                move(Robot.RED, Direction.DOWN), null);
        assertThrows(IllegalArgumentException.class,
                () -> validator.validate(start, redTarget(6, 3), 3, moves));
        assertUnchanged(snapshot, start);
    }

    @ParameterizedTest
    @CsvSource({"-1, 0", "0, -1", "7, 0", "0, 5"})
    void rejectsOutsideTarget(int x, int y) {
        assertThrows(IllegalArgumentException.class,
                () -> validator.validate(state(), redTarget(x, y), 0, List.of()));
    }

    @Test
    void rejectsBlockedTarget() {
        Board board = new Board(7, 5);
        board.blockCell(new Position(1, 1));
        GameState start = new GameState(board, positions());
        assertThrows(IllegalArgumentException.class,
                () -> validator.validate(start, redTarget(1, 1), 0, List.of()));
    }

    private void check(ValidationResult expected, GameState start, Target target, List<Move> moves) {
        GameState snapshot = start.copy();
        assertEquals(expected, validator.validate(start, target, moves.size(), moves));
        assertUnchanged(snapshot, start);
    }

    private void assertUnchanged(GameState snapshot, GameState actual) {
        for (Robot robot : Robot.values()) {
            assertEquals(snapshot.positionOf(robot), actual.positionOf(robot), robot.name());
        }
    }

    private GameState loopState(int redX) {
        Board board = new Board(7, 5);
        board.addWall(new Position(4, 1), Direction.RIGHT);
        board.addWall(new Position(4, 1), Direction.UP);
        board.addWall(new Position(4, 3), Direction.DOWN);
        board.addWall(new Position(4, 3), Direction.RIGHT);
        board.addWall(new Position(0, 3), Direction.DOWN);
        board.addWall(new Position(0, 1), Direction.UP);
        Map<Robot, Position> positions = new HashMap<>(positions());
        positions.put(Robot.RED, new Position(redX, 1));
        return new GameState(board, positions);
    }

    private GameState state() {
        return new GameState(new Board(7, 5), positions());
    }

    private Map<Robot, Position> positions() {
        return Map.of(Robot.RED, new Position(3, 2), Robot.GREEN, new Position(0, 0),
                Robot.BLUE, new Position(6, 0), Robot.YELLOW, new Position(0, 4),
                Robot.BLACK, new Position(6, 4));
    }

    private Target redTarget(int x, int y) {
        return new Target(TargetType.RED_PLANET, new Position(x, y));
    }

    private Move move(Robot robot, Direction direction) {
        return new Move(robot, direction);
    }
}
