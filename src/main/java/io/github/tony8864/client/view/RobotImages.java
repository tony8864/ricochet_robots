package io.github.tony8864.client.view;

import io.github.tony8864.engine.Robot;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.net.URL;
import java.util.EnumMap;

public class RobotImages {

    private final EnumMap<Robot, BufferedImage> images = new EnumMap<>(Robot.class);

    public RobotImages() {
        loadImages();
    }

    private void loadImages() {
        for (Robot robot : Robot.values()) {
            String path = "/images/robots/" + robot.name().toLowerCase() + "_robot.png";
            try {
                URL resource = RobotImages.class.getResource(path);
                if (resource == null) {
                    throw new IOException("Resource not found: " + path);
                }
                BufferedImage image = ImageIO.read(resource);
                if (image == null) {
                    throw new IOException("Unsupported image format: " + path);
                }
                images.put(robot, image);
            } catch (IOException e) {
                throw new IllegalStateException("Could not load image for robot: " + robot.name(), e);
            }
        }
    }

    public BufferedImage get(Robot robot) {
        if (robot == null) {
            throw new IllegalArgumentException("Robot cannot be null");
        }
        return images.get(robot);
    }
}
