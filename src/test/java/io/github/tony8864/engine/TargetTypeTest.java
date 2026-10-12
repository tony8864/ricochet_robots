package io.github.tony8864.engine;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TargetTypeTest {

    @ParameterizedTest
    @CsvSource({"RED, RED", "GREEN, GREEN", "BLUE, BLUE", "YELLOW, YELLOW"})
    void coloredTargetAcceptsOnlyMatchingRobot(TargetType target, Robot matchingRobot) {
        for (Robot robot : Robot.values()) {
            assertEquals(robot == matchingRobot, target.accepts(robot),
                    target + " target with " + robot + " robot");
        }
    }

    @ParameterizedTest
    @EnumSource(Robot.class)
    void vortexAcceptsEveryRobotIncludingBlack(Robot robot) {
        assertTrue(TargetType.VORTEX.accepts(robot));
    }

    @ParameterizedTest
    @EnumSource(TargetType.class)
    void rejectsNullRobot(TargetType target) {
        assertThrows(IllegalArgumentException.class, () -> target.accepts(null));
    }
}
