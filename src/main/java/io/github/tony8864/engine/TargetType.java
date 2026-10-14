package io.github.tony8864.engine;

public enum TargetType {
    RED_PLANET(Robot.RED, TargetShape.PLANET),
    RED_GEAR(Robot.RED, TargetShape.GEAR),
    RED_STAR(Robot.RED, TargetShape.STAR),
    RED_MOON(Robot.RED, TargetShape.MOON),

    GREEN_PLANET(Robot.GREEN, TargetShape.PLANET),
    GREEN_GEAR(Robot.GREEN, TargetShape.GEAR),
    GREEN_STAR(Robot.GREEN, TargetShape.STAR),
    GREEN_MOON(Robot.GREEN, TargetShape.MOON),

    BLUE_PLANET(Robot.BLUE, TargetShape.PLANET),
    BLUE_GEAR(Robot.BLUE, TargetShape.GEAR),
    BLUE_STAR(Robot.BLUE, TargetShape.STAR),
    BLUE_MOON(Robot.BLUE, TargetShape.MOON),

    YELLOW_PLANET(Robot.YELLOW, TargetShape.PLANET),
    YELLOW_GEAR(Robot.YELLOW, TargetShape.GEAR),
    YELLOW_STAR(Robot.YELLOW, TargetShape.STAR),
    YELLOW_MOON(Robot.YELLOW, TargetShape.MOON),

    VORTEX(null, TargetShape.VORTEX_SHAPE);

    private final Robot requiredRobot;
    private final TargetShape shape;

    TargetType(Robot requiredRobot, TargetShape shape) {
        this.requiredRobot = requiredRobot;
        this.shape = shape;
    }

    public TargetShape getShape() {
        return shape;
    }

    public boolean accepts(Robot robot) {
        if (robot == null) {
            throw new IllegalArgumentException("Robot cannot be null");
        }

        if (this == VORTEX) {
            return true;
        }

        return this.requiredRobot == robot;
    }
}
