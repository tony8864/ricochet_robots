package io.github.tony8864.board;

import io.github.tony8864.engine.Board;
import io.github.tony8864.engine.Target;

import java.util.List;

/** Fixed geometry and placed symbols, independent of robots and the active objective. */
public record BoardLayout(Board board, List<Target> targets) {
    public BoardLayout {
        if (board == null || targets == null) {
            throw new IllegalArgumentException("Board and targets cannot be null");
        }
        for (Target target : targets) {
            if (target == null) {
                throw new IllegalArgumentException("Target cannot be null");
            }
            if (!board.isPlayable(target.position())) {
                throw new IllegalArgumentException("Target position must be playable: " + target.position());
            }
        }
        targets = List.copyOf(targets);
        board.freeze();
    }
}
