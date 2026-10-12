package io.github.tony8864.engine;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TargetTest {

    @ParameterizedTest
    @EnumSource(TargetType.class)
    void retainsTargetTypeAndPosition(TargetType type) {
        Position position = new Position(3, 5);

        Target target = new Target(type, position);

        assertEquals(type, target.targetType());
        assertEquals(position, target.position());
    }

    @Test
    void rejectsNullTargetType() {
        assertThrows(IllegalArgumentException.class,
                () -> new Target(null, new Position(3, 5)));
    }

    @ParameterizedTest
    @EnumSource(TargetType.class)
    void rejectsNullPosition(TargetType type) {
        assertThrows(IllegalArgumentException.class, () -> new Target(type, null));
    }
}
