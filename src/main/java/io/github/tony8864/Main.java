package io.github.tony8864;

import io.github.tony8864.client.BoardPanel;
import io.github.tony8864.client.GamePanel;
import io.github.tony8864.client.LocalSimulationPanel;
import io.github.tony8864.client.LocalSimulationController;
import io.github.tony8864.client.RobotImages;
import io.github.tony8864.engine.*;

import javax.swing.*;
import java.util.EnumMap;

public class Main {
    public static void main(String[] args) {
        Board board = new Board(16, 16);

        board.blockCell(new Position(7, 7));
        board.blockCell(new Position(8, 7));
        board.blockCell(new Position(7, 8));
        board.blockCell(new Position(8, 8));

        board.addWall(new Position(3, 2), Direction.UP);
        board.addWall(new Position(3, 2), Direction.RIGHT);

        board.addWall(new Position(5, 6), Direction.UP);
        board.addWall(new Position(5, 6), Direction.LEFT);

        EnumMap<Robot, Position> robotPositions = new EnumMap<>(Robot.class);
        robotPositions.put(Robot.RED, new Position(2, 2));
        robotPositions.put(Robot.GREEN, new Position(5, 5));
        robotPositions.put(Robot.BLUE, new Position(10, 1));
        robotPositions.put(Robot.YELLOW, new Position(0, 14));
        robotPositions.put(Robot.BLACK, new Position(9, 13));

        GameState state = new GameState(board, robotPositions);
        Target target = new Target(TargetType.RED_PLANET, new Position(11, 3));
        RobotImages robotImages = new RobotImages();

        SwingUtilities.invokeLater(() -> {
            LocalSimulationController controller = new LocalSimulationController();
            GamePanel gamePanel = new
                    GamePanel(new BoardPanel(board, state, target, robotImages),
                    new LocalSimulationPanel(robotImages, controller));

            JFrame frame = new JFrame("Ricochet Robots");
            frame.setDefaultCloseOperation(WindowConstants.EXIT_ON_CLOSE);
            frame.add(gamePanel);
            frame.pack();
            frame.setLocationRelativeTo(null);
            frame.setVisible(true);
        });
    }
}
