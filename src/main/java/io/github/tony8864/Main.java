package io.github.tony8864;

import io.github.tony8864.board.BoardLayout;
import io.github.tony8864.board.TestBoardLayout;
import io.github.tony8864.client.view.*;
import io.github.tony8864.client.controller.LocalSimulationController;
import io.github.tony8864.engine.*;

import javax.swing.*;
import java.util.EnumMap;

public class Main {
    public static void main(String[] args) {
        BoardLayout layout = TestBoardLayout.create();
        Board board = layout.board();

        EnumMap<Robot, Position> robotPositions = new EnumMap<>(Robot.class);
        robotPositions.put(Robot.RED, new Position(2, 2));
        robotPositions.put(Robot.GREEN, new Position(5, 5));
        robotPositions.put(Robot.BLUE, new Position(10, 1));
        robotPositions.put(Robot.YELLOW, new Position(0, 14));
        robotPositions.put(Robot.BLACK, new Position(9, 14));

        GameState startingState = new GameState(board, robotPositions);
        RobotImages robotImages = new RobotImages();
        TargetImages targetImages = new TargetImages();

        SwingUtilities.invokeLater(() -> {
            GameState localState = startingState.copy();

            LocalSimulationController controller = new LocalSimulationController(localState);

            BoardPanel boardPanel = new BoardPanel(board, localState, robotImages, targetImages, layout.targets());
            LocalSimulationPanel localSimulationPanel =
                    new LocalSimulationPanel(
                            robotImages,
                            controller,
                            direction -> {
                                if (boardPanel.isAnimating()) {
                                    return;
                                }

                                Robot robot = controller.selectedRobot();
                                Position start = localState.positionOf(robot);
                                Position destination = controller.moveSelectedRobot(direction);

                                boardPanel.animateSlide(robot, start, destination);
                            }
                        );
            GamePanel gamePanel = new GamePanel(boardPanel, localSimulationPanel);

            JFrame frame = new JFrame("Ricochet Robots");
            frame.setDefaultCloseOperation(WindowConstants.EXIT_ON_CLOSE);
            frame.add(gamePanel);
            frame.pack();
            frame.setLocationRelativeTo(null);
            frame.setVisible(true);
        });
    }
}
