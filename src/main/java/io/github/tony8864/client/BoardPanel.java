package io.github.tony8864.client;

import io.github.tony8864.engine.*;
import io.github.tony8864.engine.Robot;

import javax.swing.*;
import java.awt.*;

public class BoardPanel extends JPanel {

    private static final int CELL_SIZE = 40;
    private static final int MARGIN = 20;

    private final Board board;
    private final GameState gameState;
    private final Target target;

    public BoardPanel(Board board, GameState gameState, Target target) {
        this.board = board;
        this.gameState = gameState;
        this.target = target;
        setBackground(Color.WHITE);
        setPreferredSize(new Dimension(
                board.width() * CELL_SIZE + 2 * MARGIN,
                board.height() * CELL_SIZE + 2 * MARGIN
        ));
    }

    @Override
    protected void paintComponent(Graphics g) {
        super.paintComponent(g);
        drawGridAndBlockedCells(g);
        drawWalls(g);
        drawTarget(g);
        drawRobots(g);
    }

    private void drawGridAndBlockedCells(Graphics g) {
        for (int row = 0; row < board.height(); row ++) {
            for (int col = 0; col < board.width(); col++) {
                int x = MARGIN + col * CELL_SIZE;
                int y = MARGIN + row * CELL_SIZE;

                Position position = new Position(col, row);
                if (!board.isPlayable(position)) {
                    g.setColor(Color.DARK_GRAY);
                    g.fillRect(x, y, CELL_SIZE, CELL_SIZE);
                }
                g.setColor(Color.GRAY);
                g.drawRect(x, y, CELL_SIZE, CELL_SIZE);
            }
        }
    }

    private void drawWalls(Graphics g) {
        Graphics2D walls = (Graphics2D) g.create();
        try {
            setupWallsStyle(walls);
            drawCellWalls(walls);
        } finally {
            walls.dispose();
        }
    }

    private void setupWallsStyle(Graphics2D g2d) {
        g2d.setColor(Color.BLACK);
        g2d.setStroke(new BasicStroke(4f));
    }

    private void drawCellWalls(Graphics2D g2d) {
        for (int row = 0; row < board.height(); row++) {
            for (int col = 0; col < board.width(); col++) {
                Position position = new Position(col, row);
                if (board.isPlayable(position)) {
                    for (Direction direction : Direction.values()) {
                        if (board.hasWall(position, direction)) {
                            drawIndividualWall(g2d, position, direction);
                        }
                    }
                }
            }
        }
    }

    private void drawIndividualWall(Graphics2D g2d, Position position, Direction direction) {
        int x1 = MARGIN + position.x() * CELL_SIZE;
        int y1 = MARGIN + position.y() * CELL_SIZE;

        int x2 = x1 + CELL_SIZE;
        int y2 = y1 + CELL_SIZE;

        switch (direction) {
            case UP:
                y2 = y1;
                break;
            case DOWN:
                y1 = y2;
                break;
            case LEFT:
                x2 = x1;
                break;
            case RIGHT:
                x1 = x2;
                break;
        }

        g2d.drawLine(x1, y1, x2, y2);
    }

    private void drawRobots(Graphics g) {
        for (Robot robot : Robot.values()) {
            Position position = gameState.positionOf(robot);
            int x = MARGIN + position.x() * CELL_SIZE + 8;
            int y = MARGIN + position.y() * CELL_SIZE + 8;
            int diameter = CELL_SIZE - 16;
            g.setColor(getRobotColor(robot));
            g.fillOval(x, y, diameter, diameter);
            g.setColor(Color.DARK_GRAY);
            g.drawOval(x, y, diameter, diameter);
        }
    }

    private Color getRobotColor(Robot robot) {
        return switch (robot) {
            case RED -> Color.RED;
            case GREEN -> Color.GREEN;
            case BLUE -> Color.BLUE;
            case YELLOW -> Color.YELLOW;
            case BLACK -> Color.BLACK;
        };
    }

    private void drawTarget(Graphics g) {
        int x = MARGIN + target.position().x() * CELL_SIZE + 8;
        int y = MARGIN + target.position().y() * CELL_SIZE + 8;
        int diameter = CELL_SIZE - 16;
        Graphics2D g2d = (Graphics2D) g.create();
        try {
            g2d.setColor(Color.RED);
            g2d.setStroke(new BasicStroke(3f));
            g2d.drawOval(x, y, diameter, diameter);
        } finally {
            g2d.dispose();
        }
    }
}
