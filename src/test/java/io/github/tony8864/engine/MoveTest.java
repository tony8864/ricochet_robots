package io.github.tony8864.engine;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class MoveTest {

    @ParameterizedTest
    @EnumSource(Robot.class)
    void acceptsEveryRobotAndDirection(Robot robot) {
        for (Direction direction : Direction.values()) {
            Move move = new Move(robot, direction);

            assertEquals(robot, move.robot());
            assertEquals(direction, move.direction());
        }
    }

    @Test
    void rejectsNullRobot() {
        assertThrows(IllegalArgumentException.class, () -> new Move(null, Direction.UP));
    }

    @Test
    void rejectsNullDirection() {
        assertThrows(IllegalArgumentException.class, () -> new Move(Robot.RED, null));
    }

    @Test
    void rejectsBothNullComponents() {
        assertThrows(IllegalArgumentException.class, () -> new Move(null, null));
    }
}
