package io.github.tony8864.board;

import io.github.tony8864.engine.Board;
import io.github.tony8864.engine.Direction;
import io.github.tony8864.engine.Position;
import io.github.tony8864.engine.Target;
import io.github.tony8864.engine.TargetType;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class TestBoardLayoutTest {
    @Test
    void hasOnlyFourBlockedCenterCells() {
        Board board = TestBoardLayout.create().board();
        assertEquals(16, board.width());
        assertEquals(16, board.height());
        for (int y = 0; y < 16; y++) {
            for (int x = 0; x < 16; x++) {
                boolean center = (x == 7 || x == 8) && (y == 7 || y == 8);
                assertEquals(!center, board.isPlayable(new Position(x, y)));
            }
        }
    }

    @Test
    void representativeCornersAndEdgeWallsAreMirrored() {
        Board board = TestBoardLayout.create().board();
        assertTrue(board.hasWall(new Position(5, 1), Direction.LEFT));
        assertTrue(board.hasWall(new Position(4, 1), Direction.RIGHT));
        assertTrue(board.hasWall(new Position(5, 1), Direction.DOWN));
        assertFalse(board.hasWall(new Position(5, 1), Direction.UP));
        assertTrue(board.hasWall(new Position(14, 14), Direction.UP));
        assertTrue(board.hasWall(new Position(14, 14), Direction.RIGHT));
        assertTrue(board.hasWall(new Position(2, 0), Direction.RIGHT));
        assertTrue(board.hasWall(new Position(3, 0), Direction.LEFT));
    }

    @Test
    void createsIndependentFrozenBoardsWithPhotoTargets() {
        BoardLayout first = TestBoardLayout.create();
        BoardLayout second = TestBoardLayout.create();
        assertNotSame(first.board(), second.board());
        assertEquals(17, first.targets().size());
        assertEquals(17L, first.targets().stream().map(Target::position).distinct().count());
        assertTrue(first.targets().contains(new Target(TargetType.BLUE_PLANET, new Position(5, 1))));
        assertTrue(first.targets().contains(new Target(TargetType.VORTEX, new Position(7, 2))));
        assertTrue(first.targets().stream().allMatch(target -> first.board().isPlayable(target.position())));
        assertThrows(IllegalStateException.class,
                () -> first.board().blockCell(new Position(0, 0)));
    }
}
