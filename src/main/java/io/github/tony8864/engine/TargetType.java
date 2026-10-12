package io.github.tony8864.engine;

public enum TargetType {
    RED,
    GREEN,
    BLUE,
    YELLOW,
    VORTEX;

    public boolean accepts(Robot robot) {
        if (robot == null) {
            throw new IllegalArgumentException(
                    "Robot cannot be null"
            );
        }

        return switch (this) {
            case RED -> robot == Robot.RED;
            case GREEN -> robot == Robot.GREEN;
            case BLUE -> robot == Robot.BLUE;
            case YELLOW -> robot == Robot.YELLOW;
            case VORTEX -> true;
        };
    }
}
