package io.github.tony8864.engine;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TargetTypeTest {

    @ParameterizedTest
    @CsvSource({
            "RED_PLANET, PLANET", "RED_GEAR, GEAR", "RED_STAR, STAR", "RED_MOON, MOON",
            "GREEN_PLANET, PLANET", "GREEN_GEAR, GEAR", "GREEN_STAR, STAR", "GREEN_MOON, MOON",
            "BLUE_PLANET, PLANET", "BLUE_GEAR, GEAR", "BLUE_STAR, STAR", "BLUE_MOON, MOON",
            "YELLOW_PLANET, PLANET", "YELLOW_GEAR, GEAR", "YELLOW_STAR, STAR", "YELLOW_MOON, MOON",
            "VORTEX, VORTEX_SHAPE"
    })
    void exposesExpectedShape(TargetType target, TargetShape expectedShape) {
        assertEquals(expectedShape, target.getShape());
    }

    @ParameterizedTest
    @CsvSource({"RED_PLANET, RED", "RED_GEAR, RED", "RED_STAR, RED", "RED_MOON, RED", "GREEN_PLANET, GREEN", "GREEN_GEAR, GREEN", "GREEN_STAR, GREEN", "GREEN_MOON, GREEN", "BLUE_PLANET, BLUE", "BLUE_GEAR, BLUE", "BLUE_STAR, BLUE", "BLUE_MOON, BLUE", "YELLOW_PLANET, YELLOW", "YELLOW_GEAR, YELLOW", "YELLOW_STAR, YELLOW", "YELLOW_MOON, YELLOW"})
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
