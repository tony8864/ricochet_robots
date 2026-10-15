package io.github.tony8864.board;

import io.github.tony8864.engine.Board;
import io.github.tony8864.engine.Position;
import io.github.tony8864.engine.Target;
import io.github.tony8864.engine.TargetType;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class BoardLayoutTest {
    @Test
    void copiesTargetsAndFreezesGeometry() {
        Board board = new Board(4, 4);
        Target target = new Target(TargetType.RED_PLANET, new Position(1, 1));
        List<Target> supplied = new ArrayList<>(List.of(target));
        BoardLayout layout = new BoardLayout(board, supplied);

        supplied.clear();

        assertSame(board, layout.board());
        assertEquals(List.of(target), layout.targets());
        assertThrows(UnsupportedOperationException.class, () -> layout.targets().clear());
        assertThrows(IllegalStateException.class, () -> board.blockCell(new Position(0, 0)));
    }

    @Test
    void rejectsUnplayableTargetsWithoutFreezingBoard() {
        Board board = new Board(4, 4);
        board.blockCell(new Position(1, 1));
        for (Position position : List.of(new Position(1, 1), new Position(4, 0))) {
            Target target = new Target(TargetType.RED_PLANET, position);
            assertThrows(IllegalArgumentException.class, () -> new BoardLayout(board, List.of(target)));
        }
        assertDoesNotThrow(() -> board.blockCell(new Position(0, 0)));
    }

    @Test
    void rejectsNullInputsAndEntries() {
        Board board = new Board(4, 4);
        assertThrows(IllegalArgumentException.class, () -> new BoardLayout(null, List.of()));
        assertThrows(IllegalArgumentException.class, () -> new BoardLayout(board, null));
        List<Target> targets = new ArrayList<>();
        targets.add(null);
        assertThrows(IllegalArgumentException.class, () -> new BoardLayout(board, targets));
        assertDoesNotThrow(() -> board.blockCell(new Position(0, 0)));
    }
}
