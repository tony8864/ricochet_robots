package io.github.tony8864.engine;

public record Move(Robot robot, Direction direction) {
    public Move {
        if (robot == null || direction == null) {
            throw new IllegalArgumentException(
                    "Robot or direction cannot be null"
            );
        }
    }
}
