package io.github.tony8864.engine;

public record Target(TargetType targetType, Position position) {
    public Target {
        if (targetType == null) {
            throw new IllegalArgumentException(
                    "Target type cannot be null"
            );
        }

        if (position == null) {
            throw new IllegalArgumentException(
                    "Position cannot be null"
            );
        }
    }
}
