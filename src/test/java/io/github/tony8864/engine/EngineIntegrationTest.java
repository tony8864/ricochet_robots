package io.github.tony8864.engine;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EngineIntegrationTest {
    private final SolutionValidator validator = new SolutionValidator();

    @ParameterizedTest
    @CsvSource({"RED, RED", "GREEN, GREEN", "BLUE, BLUE", "YELLOW, YELLOW"})
    void everyColoredRobotSolvesItsMatchingTarget(TargetType type, Robot solver) {
        GameState start = cornerState(solver);
        assertSolution(start, new Target(type, new Position(6, 3)), ValidationResult.VALID,
                List.of(new Move(solver, Direction.RIGHT), new Move(solver, Direction.DOWN)));
    }

    @ParameterizedTest
    @EnumSource(Robot.class)
    void everyRobotSolvesVortex(Robot solver) {
        GameState start = cornerState(solver);
        assertSolution(start, new Target(TargetType.VORTEX, new Position(6, 3)),
                ValidationResult.VALID,
                List.of(new Move(solver, Direction.RIGHT), new Move(solver, Direction.DOWN)));
    }

    @ParameterizedTest
    @CsvSource({"RED, GREEN", "GREEN, BLUE", "BLUE, YELLOW", "YELLOW, RED"})
    void coloredTargetsRejectOtherColoredRobots(TargetType type, Robot wrongRobot) {
        assertSolution(cornerState(wrongRobot), new Target(type, new Position(6, 3)),
                ValidationResult.TARGET_NOT_REACHED,
                List.of(new Move(wrongRobot, Direction.RIGHT), new Move(wrongRobot, Direction.DOWN)));
    }

    @Test
    void movedHelperCreatesStopNeededToSolveTarget() {
        Board board = new Board(7, 5);
        board.addWall(new Position(4, 3), Direction.DOWN);
        board.addWall(new Position(1, 3), Direction.DOWN);
        Map<Robot, Position> positions = new EnumMap<>(Robot.class);
        positions.put(Robot.RED, new Position(1, 1));
        positions.put(Robot.BLACK, new Position(4, 0));
        positions.put(Robot.GREEN, new Position(0, 0));
        positions.put(Robot.BLUE, new Position(6, 0));
        positions.put(Robot.YELLOW, new Position(0, 4));
        GameState start = new GameState(board, positions);
        Target target = new Target(TargetType.RED, new Position(3, 3));

        // No wall stops red at the target: black must provide the obstacle.
        assertFalse(start.isOccupied(new Position(4, 3)));
        assertFalse(board.hasWall(target.position(), Direction.RIGHT));
        assertSolution(start, target, ValidationResult.TARGET_NOT_REACHED, List.of(
                new Move(Robot.RED, Direction.DOWN), new Move(Robot.RED, Direction.RIGHT)));

        List<Move> solution = List.of(new Move(Robot.BLACK, Direction.DOWN),
                new Move(Robot.RED, Direction.DOWN), new Move(Robot.RED, Direction.RIGHT));
        assertSolution(start, target, ValidationResult.VALID, solution);
        GameState finalState = start.replay(solution);
        assertEquals(new Position(4, 3), finalState.positionOf(Robot.BLACK));
        assertEquals(target.position(), finalState.positionOf(Robot.RED));
        assertTrue(finalState.isOccupied(new Position(4, 3)));
    }

    @ParameterizedTest
    @CsvSource({"RED, RED", "GREEN, GREEN", "BLUE, BLUE", "YELLOW, YELLOW"})
    void everyColoredRobotCanLeaveAndReturnToOccupiedTarget(TargetType type, Robot solver) {
        assertSolution(loopState(solver), new Target(type, new Position(0, 1)),
                ValidationResult.VALID, loopMoves(solver));
    }

    @ParameterizedTest
    @EnumSource(Robot.class)
    void everyRobotCanLeaveAndReturnToOccupiedVortex(Robot solver) {
        assertSolution(loopState(solver), new Target(TargetType.VORTEX, new Position(0, 1)),
                ValidationResult.VALID, loopMoves(solver));
    }

    @ParameterizedTest
    @EnumSource(Robot.class)
    void occupiedVortexDoesNotAwardSuccessForTwoSlideReversal(Robot solver) {
        assertSolution(loopState(solver), new Target(TargetType.VORTEX, new Position(0, 1)),
                ValidationResult.REQUIRED_TURN_MISSING,
                List.of(new Move(solver, Direction.RIGHT), new Move(solver, Direction.LEFT)));
    }

    private void assertSolution(GameState start, Target target, ValidationResult expected,
                                List<Move> moves) {
        GameState snapshot = start.copy();
        assertEquals(expected, validator.validate(start, target, moves.size(), moves));
        for (Robot robot : Robot.values()) {
            assertEquals(snapshot.positionOf(robot), start.positionOf(robot), robot.name());
        }
        if (expected == ValidationResult.VALID) {
            GameState replayed = start.replay(moves);
            boolean solved = false;
            for (Robot robot : Robot.values()) {
                if (target.targetType().accepts(robot)
                        && target.position().equals(replayed.positionOf(robot))) {
                    solved = true;
                }
            }
            assertTrue(solved, "Validated sequence must replay to the target");
        }
    }

    private GameState cornerState(Robot solver) {
        return new GameState(new Board(7, 5), positionsWithSolverAt(solver, new Position(3, 2)));
    }

    private GameState loopState(Robot solver) {
        Board board = new Board(7, 5);
        board.addWall(new Position(4, 1), Direction.RIGHT);
        board.addWall(new Position(4, 3), Direction.DOWN);
        board.addWall(new Position(0, 1), Direction.UP);
        return new GameState(board, positionsWithSolverAt(solver, new Position(0, 1)));
    }

    private List<Move> loopMoves(Robot solver) {
        return List.of(new Move(solver, Direction.RIGHT), new Move(solver, Direction.DOWN),
                new Move(solver, Direction.LEFT), new Move(solver, Direction.UP));
    }

    private Map<Robot, Position> positionsWithSolverAt(Robot solver, Position start) {
        Map<Robot, Position> positions = new EnumMap<>(Robot.class);
        positions.put(Robot.RED, start);
        positions.put(Robot.GREEN, new Position(0, 0));
        positions.put(Robot.BLUE, new Position(6, 0));
        positions.put(Robot.YELLOW, new Position(0, 4));
        positions.put(Robot.BLACK, new Position(6, 4));
        if (solver != Robot.RED) {
            positions.put(Robot.RED, positions.get(solver));
            positions.put(solver, start);
        }
        return positions;
    }
}
