package io.github.tony8864.client.view;

import io.github.tony8864.client.controller.LocalSimulationController;
import io.github.tony8864.engine.Direction;
import io.github.tony8864.engine.Robot;

import javax.imageio.ImageIO;
import javax.swing.*;
import javax.swing.border.TitledBorder;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.net.URL;
import java.util.Locale;
import java.util.function.Consumer;

public class LocalSimulationPanel extends JPanel {

    private static final int ROBOT_ICON_SIZE = 24;

    private final RobotImages robotImages;
    private final LocalSimulationController controller;
    private final Consumer<Direction> moveRobot;

    public LocalSimulationPanel(RobotImages robotImages, LocalSimulationController controller, Consumer<Direction> moveRobot) {
        this.robotImages = robotImages;
        this.controller = controller;
        this.moveRobot = moveRobot;
        setupPaneLayout();
        add(createContentPanel(), BorderLayout.CENTER);
    }

    private void setupPaneLayout() {
        setLayout(new BorderLayout(0, 8));
        setBackground(new Color(238, 240, 240));
        setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(new Color(185, 198, 212)),
                BorderFactory.createEmptyBorder(4, 4, 4, 4)
        ));
    }

    private JPanel createContentPanel() {
        JPanel content = new JPanel(new GridBagLayout());
        JPanel robotSelectionPanel = createRobotSelectionPanel();
        JPanel movementControlsPanel = createMovementControlsPanel();
        GridBagConstraints constraints = new GridBagConstraints();
        constraints.gridy = 0;
        constraints.fill = GridBagConstraints.VERTICAL;
        constraints.anchor = GridBagConstraints.WEST;

        constraints.gridx = 0;
        constraints.insets = new Insets(0, 0, 0, 12);
        content.add(robotSelectionPanel, constraints);

        constraints.gridx = 1;
        constraints.insets = new Insets(0, 0, 0, 0);
        content.add(movementControlsPanel, constraints);

        constraints.gridx = 2;
        constraints.weightx = 1;
        content.add(Box.createHorizontalGlue(), constraints);
        content.setBorder(BorderFactory.createEmptyBorder(12, 12, 12, 12));
        return content;
    }

    private JPanel createRobotSelectionPanel() {
        JPanel panel = new JPanel();
        panel.setLayout(new GridLayout(0, 1, 0, 2));
        panel.setBorder(BorderFactory.createCompoundBorder(
                createBoldTitledBorder("Select Robot"),
                BorderFactory.createEmptyBorder(4, 8, 4, 8)
        ));
        ButtonGroup robotSelectionGroup = new ButtonGroup();
        populateRobotRadioButtons(panel, robotSelectionGroup);
        return panel;
    }

    private void populateRobotRadioButtons(JPanel selectionPanel, ButtonGroup robotSelectionGroup) {
        Robot[] robots = Robot.values();
        for (int i = 0; i < robots.length; i++) {
            int displayIndex = i + 1;
            selectionPanel.add(createRobotSelectionRow(robots[i], robotSelectionGroup, displayIndex));
        }
    }

    private JPanel createRobotSelectionRow(Robot robot, ButtonGroup robotSelectionGroup, int index) {
        String name = robot.name().toLowerCase(Locale.ROOT);
        String buttonText = index + ". " + Character.toUpperCase(name.charAt(0)) + name.substring(1) + " Robot";
        Image image = robotImages.get(robot).getScaledInstance(
                ROBOT_ICON_SIZE, ROBOT_ICON_SIZE, Image.SCALE_SMOOTH);
        JLabel label = new JLabel(buttonText, new ImageIcon(image), JLabel.LEFT);
        label.setIconTextGap(8);

        JRadioButton radioButton = new JRadioButton();
        radioButton.setSelected(robot == controller.selectedRobot());
        radioButton.addActionListener(_ -> controller.selectRobot(robot));
        radioButton.getAccessibleContext().setAccessibleName(buttonText);
        label.setLabelFor(radioButton);
        label.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent event) {
                radioButton.doClick();
            }
        });

        JPanel row = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 0));
        row.add(radioButton);
        row.add(label);
        robotSelectionGroup.add(radioButton);
        return row;
    }

    private JPanel createMovementControlsPanel() {
        JPanel panel = new JPanel(new BorderLayout());
        panel.setBorder(
                createBoldTitledBorder("Movement Controls")
        );

        ImageIcon upIcon = loadUpArrowIcon();

        ImageIcon rightIcon = rotateIcon(upIcon, Math.toRadians(90));
        ImageIcon downIcon  = rotateIcon(upIcon, Math.toRadians(180));
        ImageIcon leftIcon  = rotateIcon(upIcon, Math.toRadians(270));

        JButton up = createMovementButton(upIcon, "Move up");
        JButton right = createMovementButton(rightIcon, "Move right");
        JButton down = createMovementButton(downIcon, "Move down");
        JButton left = createMovementButton(leftIcon, "Move left");

        up.addActionListener(_ -> moveRobot(Direction.UP));
        right.addActionListener(_ -> moveRobot(Direction.RIGHT));
        down.addActionListener(_ -> moveRobot(Direction.DOWN));
        left.addActionListener(_ -> moveRobot(Direction.LEFT));

        JPanel arrowGrid = new JPanel(new GridLayout(3, 3, 4, 4));
        arrowGrid.add(new JPanel());
        arrowGrid.add(up);
        arrowGrid.add(new JPanel());
        arrowGrid.add(left);
        arrowGrid.add(new JPanel());
        arrowGrid.add(right);
        arrowGrid.add(new JPanel());
        arrowGrid.add(down);
        arrowGrid.add(new JPanel());

        JPanel wrapper = new JPanel(new FlowLayout(FlowLayout.CENTER, 8, 8));
        wrapper.add(arrowGrid);
        panel.add(wrapper, BorderLayout.CENTER);

        return panel;
    }

    private JButton createMovementButton(ImageIcon icon, String description) {
        JButton button = new JButton(icon);
        button.setToolTipText(description);
        button.getAccessibleContext().setAccessibleName(description);
        button.setPreferredSize(new Dimension(56, 42));
        return button;
    }

    private TitledBorder createBoldTitledBorder(String title) {
        TitledBorder border = BorderFactory.createTitledBorder(title);
        border.setTitleFont(border.getTitleFont().deriveFont(Font.BOLD));
        return border;
    }

    private ImageIcon loadUpArrowIcon() {
        String path = "/images/controls/arrow_up.png";
        try {
            URL resource = LocalSimulationPanel.class.getResource(path);
            if (resource == null) {
                throw new IOException("Resource not found: " + path);
            }
            BufferedImage image = ImageIO.read(resource);
            if (image == null) {
                throw new IOException("Unsupported image format: " + path);
            }
            Image scaled = image.getScaledInstance(24, 24, Image.SCALE_SMOOTH);
            return new ImageIcon(scaled);
        } catch (IOException e) {
            throw new IllegalStateException("Could not load up arrow image", e);
        }
    }

    private ImageIcon rotateIcon(ImageIcon sourceIcon, double radians) {
        int width = sourceIcon.getIconWidth();
        int height = sourceIcon.getIconHeight();

        BufferedImage rotatedImage = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g2d = rotatedImage.createGraphics();

        try {
            g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2d.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g2d.rotate(radians, width / 2.0, height / 2.0);
            g2d.drawImage(sourceIcon.getImage(), 0, 0, null);
        } finally {
            g2d.dispose();
        }

        return new ImageIcon(rotatedImage);
    }

    private void moveRobot(Direction direction) {
        moveRobot.accept(direction);
    }
}
