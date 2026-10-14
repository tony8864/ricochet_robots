package io.github.tony8864.client;

import io.github.tony8864.engine.Robot;

public class LocalSimulationController {
    private Robot selectedRobot = Robot.RED;

    public Robot selectedRobot() {
        return selectedRobot;
    }

    public void selectRobot(Robot robot) {
        if (robot == null) {
            throw new IllegalArgumentException("Robot cannot be null");
        }
        selectedRobot = robot;
        System.out.println("Selected robot: " + robot);
    }
}
