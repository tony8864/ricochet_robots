package io.github.tony8864.client.view;

import io.github.tony8864.engine.TargetType;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.net.URL;
import java.util.EnumMap;
import java.util.Locale;

public class TargetImages {
    private final EnumMap<TargetType, BufferedImage> images = new EnumMap<>(TargetType.class);

    public TargetImages() {
        for (TargetType targetType : TargetType.values()) {
            String path = resourcePath(targetType);
            try {
                URL resource = TargetImages.class.getResource(path);
                if (resource == null) {
                    throw new IOException("Resource not found: " + path);
                }
                BufferedImage image = ImageIO.read(resource);
                if (image == null) {
                    throw new IOException("Unsupported image format: " + path);
                }
                images.put(targetType, image);
            } catch (IOException e) {
                throw new IllegalStateException("Could not load image for target: " + targetType, e);
            }
        }
    }

    public BufferedImage get(TargetType targetType) {
        if (targetType == null) {
            throw new IllegalArgumentException("Target type cannot be null");
        }
        return images.get(targetType);
    }

    private String resourcePath(TargetType targetType) {
        if (targetType == TargetType.VORTEX) {
            return "/images/targets/vortex.png";
        }
        // The GEAR targets use the artwork named "sun" in the resources.
        String shape = switch (targetType.getShape()) {
            case PLANET -> "planet";
            case GEAR -> "sun";
            case STAR -> "star";
            case MOON -> "moon";
            case VORTEX_SHAPE -> throw new IllegalArgumentException("Unexpected colored vortex target");
        };
        String name = targetType.name().toLowerCase(Locale.ROOT);
        String color = name.substring(0, name.indexOf('_'));
        return "/images/targets/" + shape + "/" + color + "_" + shape + ".png";
    }
}
