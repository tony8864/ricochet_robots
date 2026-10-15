package io.github.tony8864.client.controller;

import io.github.tony8864.engine.Direction;
import io.github.tony8864.engine.GameState;
import io.github.tony8864.engine.Position;
import io.github.tony8864.engine.Robot;

public class LocalSimulationController {

    private final GameState localState;
    private Robot selectedRobot = Robot.RED;

    public LocalSimulationController(GameState localState) {
        this.localState = localState;
    }

    public Robot selectedRobot() {
        return selectedRobot;
    }

    public Position moveSelectedRobot(Direction direction) {
        return localState.move(selectedRobot, direction);
    }

    public void selectRobot(Robot robot) {
        if (robot == null) {
            throw new IllegalArgumentException("Robot cannot be null");
        }
        selectedRobot = robot;
        System.out.println("Selected robot: " + robot);
    }
}
