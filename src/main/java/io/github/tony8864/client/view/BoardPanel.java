package io.github.tony8864.client.view;

import io.github.tony8864.engine.*;
import io.github.tony8864.engine.Robot;

import javax.swing.*;
import java.awt.*;
import java.util.List;

public class BoardPanel extends JPanel {

    private static final int CELL_SIZE = 35;
    private static final int MARGIN = 30;

    private static final double SLIDE_SPEED = 8.0;

    private final Board board;
    private final GameState gameState;
    private final RobotImages robotImages;
    private final TargetImages targetImages;
    private final List<Target> targets;

    private Robot animatedRobot;
    private DisplayPosition animationPosition;

    public BoardPanel(Board board, GameState gameState, RobotImages robotImages,
                      TargetImages targetImages, List<Target> targets) {
        this.board = board;
        this.gameState = gameState;
        this.robotImages = robotImages;
        this.targetImages = targetImages;
        this.targets = List.copyOf(targets);
        setupPanelProperties();
    }

    public boolean isAnimating() {
        return animatedRobot != null;
    }

    public void animateSlide(Robot robot, Position start, Position destination) {
        int distance = Math.abs(destination.x() - start.x()) + Math.abs(destination.y() - start.y());

        if (distance == 0) {
            return;
        }

        double durationSeconds = distance / SLIDE_SPEED;
        long startedAt = System.nanoTime();

        showAnimationPosition(robot, new DisplayPosition(start.x(), start.y()));
        Timer timer = new Timer(16, event -> {
            double elapsedSeconds = (System.nanoTime() - startedAt) / 1_000_000_000.0;
            double progress = Math.min(1.0, elapsedSeconds / durationSeconds);

            double x = start.x() + (destination.x() - start.x()) * progress;
            double y = start.y() + (destination.y() - start.y()) * progress;

            showAnimationPosition(robot, new DisplayPosition(x, y));
            if (progress >= 1.0) {
                ((Timer) event.getSource()).stop();
                clearAnimationPosition();
            }
        });
        timer.start();
    }

    private void setupPanelProperties() {
        setOpaque(true);
        setBorder(BorderFactory.createLineBorder(
                new Color(185, 198, 212), 1
        ));
        setPreferredSize(new Dimension(
                board.width() * CELL_SIZE + 2 * MARGIN,
                board.height() * CELL_SIZE + 2 * MARGIN
        ));
    }

    private void showAnimationPosition(Robot robot, DisplayPosition displayPosition) {
        animatedRobot = robot;
        animationPosition = displayPosition;
        repaint();
    }

    private void clearAnimationPosition() {
        animatedRobot = null;
        animationPosition = null;
        repaint();
    }


    @Override
    protected void paintComponent(Graphics g) {
        super.paintComponent(g);
        g.setColor(Color.DARK_GRAY);
        drawGridAndBlockedCells(g);
        drawCoordinates(g);
        drawWalls(g);
        drawTargets(g);
        drawRobots(g);
    }

    private void drawGridAndBlockedCells(Graphics g) {
        Graphics2D g2d = (Graphics2D) g.create();
        try {
            renderGrid(g2d);
        } finally {
            g2d.dispose();
        }
    }

    private void renderGrid(Graphics2D g2d) {
        for (int row = 0; row < board.height(); row++) {
            for (int col = 0; col < board.width(); col++) {
                int x = MARGIN + col * CELL_SIZE;
                int y = MARGIN + row * CELL_SIZE;
                Position position = new Position(col, row);
                if (!board.isPlayable(position)) {
                    fillBlockedCell(g2d, x, y);
                } else {
                    fillPlayableCell(g2d, x, y);
                }
                drawCellOutline(g2d, x, y);
            }
        }
    }

    private void fillBlockedCell(Graphics2D g2d, int x, int y) {
        g2d.setColor(Color.DARK_GRAY);
        g2d.fillRect(x, y, CELL_SIZE, CELL_SIZE);
    }

    private void fillPlayableCell(Graphics2D g2d, int x, int y) {
        g2d.setPaint(new GradientPaint(
                x, y, new Color(255, 255, 255),
                x + CELL_SIZE, y + CELL_SIZE, new Color(238, 240, 243)
        ));
        g2d.fillRect(x, y, CELL_SIZE, CELL_SIZE);
    }

    private void drawCellOutline(Graphics2D g2d, int x, int y) {
        g2d.setColor(Color.GRAY);
        g2d.drawRect(x, y, CELL_SIZE, CELL_SIZE);
    }

    private void drawCoordinates(Graphics g) {
        g.setFont(g.getFont().deriveFont(Font.BOLD));
        FontMetrics metrics = g.getFontMetrics();
        for (int col = 0; col < board.width(); col++) {
            String label = String.valueOf((char) ('A' + col));
            int centerX = MARGIN + col * CELL_SIZE + CELL_SIZE / 2;
            int textX = centerX - metrics.stringWidth(label) / 2;
            g.drawString(label, textX, MARGIN - 8);
            g.drawString(label, textX, MARGIN + board.height() * CELL_SIZE + metrics.getAscent() + 8);
        }

        for (int row = 0; row < board.height(); row++) {
            String label = String.valueOf(row + 1);
            int centerY = MARGIN + row * CELL_SIZE + CELL_SIZE / 2;
            int textY = centerY + (metrics.getAscent() - metrics.getDescent()) / 2;
            g.drawString(label, MARGIN - 8 - metrics.stringWidth(label), textY);
            g.drawString(label, MARGIN + board.width() * CELL_SIZE + 8, textY);
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
        int size = (int) Math.round(CELL_SIZE * 0.8);
        int inset = (CELL_SIZE - size) / 2;
        for (Robot robot : Robot.values()) {
            DisplayPosition position = displayPositionOf(robot);
            int x = MARGIN + (int) Math.round(position.x() * CELL_SIZE) + inset;
            int y = MARGIN + (int) Math.round(position.y() * CELL_SIZE) + inset;
            g.drawImage(robotImages.get(robot), x, y, size, size, this);
        }
    }

    private void drawTargets(Graphics g) {
        int diameter = (int) Math.round(CELL_SIZE * 0.8);
        int inset = (CELL_SIZE - diameter) / 2;
        for (Target target : targets) {
            int x = MARGIN + target.position().x() * CELL_SIZE + inset;
            int y = MARGIN + target.position().y() * CELL_SIZE + inset;
            g.drawImage(
                    targetImages.get(target.targetType()),
                    x, y, diameter, diameter, this
            );
        }
    }

    private DisplayPosition displayPositionOf(Robot robot) {
        if (robot == animatedRobot) {
            return animationPosition;
        }
        Position position = gameState.positionOf(robot);
        return new DisplayPosition(position.x(), position.y());
    }
}
