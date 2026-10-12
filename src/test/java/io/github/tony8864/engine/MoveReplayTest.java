package io.github.tony8864.engine;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

class MoveReplayTest {

    @Test
    void replaysMovesInOrderWithUpdatedRobotBlocking() {
        GameState original = startingState();

        GameState result = original.replay(List.of(
                new Move(Robot.BLACK, Direction.RIGHT),
                new Move(Robot.RED, Direction.DOWN),
                new Move(Robot.RED, Direction.RIGHT)
        ));

        assertEquals(new Position(4, 1), result.positionOf(Robot.BLACK));
        assertEquals(new Position(3, 1), result.positionOf(Robot.RED));
        assertEquals(new Position(4, 0), result.positionOf(Robot.GREEN));
        assertEquals(new Position(0, 2), result.positionOf(Robot.BLUE));
        assertEquals(new Position(4, 2), result.positionOf(Robot.YELLOW));
        assertStartingPositions(original);
    }

    @Test
    void emptySequenceReturnsIndependentUnchangedCopy() {
        GameState original = startingState();

        GameState result = original.replay(List.of());

        assertNotSame(original, result);
        assertStartingPositions(result);
        result.move(Robot.BLACK, Direction.RIGHT);
        assertEquals(new Position(4, 1), result.positionOf(Robot.BLACK));
        assertStartingPositions(original);
    }

    @Test
    void replayStartsFromCurrentPositions() {
        GameState original = startingState();
        original.move(Robot.BLACK, Direction.RIGHT);

        GameState result = original.replay(List.of(
                new Move(Robot.RED, Direction.DOWN),
                new Move(Robot.RED, Direction.RIGHT)
        ));

        assertEquals(new Position(3, 1), result.positionOf(Robot.RED));
        assertEquals(new Position(4, 1), result.positionOf(Robot.BLACK));
        assertEquals(new Position(0, 0), original.positionOf(Robot.RED));
        assertEquals(new Position(4, 1), original.positionOf(Robot.BLACK));
    }

    @Test
    void independentReplaysDoNotAffectEachOtherOrOriginal() {
        GameState original = startingState();

        GameState right = original.replay(List.of(new Move(Robot.BLACK, Direction.RIGHT)));
        GameState left = original.replay(List.of(new Move(Robot.BLACK, Direction.LEFT)));
        left.move(Robot.BLACK, Direction.RIGHT);

        assertEquals(new Position(4, 1), right.positionOf(Robot.BLACK));
        assertEquals(new Position(4, 1), left.positionOf(Robot.BLACK));
        right.move(Robot.BLACK, Direction.LEFT);
        assertEquals(new Position(0, 1), right.positionOf(Robot.BLACK));
        assertEquals(new Position(4, 1), left.positionOf(Robot.BLACK));
        assertStartingPositions(original);
    }

    @Test
    void replayUsesBoardWallsAndBlockedCells() {
        Board board = new Board(5, 3);
        board.addWall(new Position(3, 1), Direction.RIGHT);
        board.blockCell(new Position(1, 1));
        GameState original = new GameState(board, startingPositions());

        GameState result = original.replay(List.of(
                new Move(Robot.BLACK, Direction.RIGHT),
                new Move(Robot.BLACK, Direction.LEFT)
        ));

        assertEquals(new Position(2, 1), result.positionOf(Robot.BLACK));
        assertStartingPositions(original);
    }

    @Test
    void rejectsNullListWithoutChangingOriginal() {
        GameState original = startingState();

        assertThrows(IllegalArgumentException.class, () -> original.replay(null));
        assertStartingPositions(original);
    }

    @Test
    void rejectsNullEntryWithoutChangingOriginal() {
        GameState original = startingState();
        // Arrays.asList permits null entries, unlike List.of.
        List<Move> moves = Arrays.asList(new Move(Robot.BLACK, Direction.RIGHT), null);

        assertThrows(IllegalArgumentException.class, () -> original.replay(moves));
        assertStartingPositions(original);
    }

    private GameState startingState() {
        return new GameState(new Board(5, 3), startingPositions());
    }

    private Map<Robot, Position> startingPositions() {
        return Map.of(
                Robot.RED, new Position(0, 0),
                Robot.GREEN, new Position(4, 0),
                Robot.BLUE, new Position(0, 2),
                Robot.YELLOW, new Position(4, 2),
                Robot.BLACK, new Position(2, 1)
        );
    }

    private void assertStartingPositions(GameState state) {
        Map<Robot, Position> expected = startingPositions();
        for (Robot robot : Robot.values()) {
            assertEquals(expected.get(robot), state.positionOf(robot), robot.name());
        }
    }
}
