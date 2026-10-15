package io.github.tony8864.client.view;

import javax.swing.*;
import java.awt.*;

public class GamePanel extends JPanel {

    private final BoardPanel boardPanel;
    private final LocalSimulationPanel localSimulationPanel;

    public GamePanel(
            BoardPanel boardPanel,
            LocalSimulationPanel localSimulationPanel
    ) {
        this.boardPanel = boardPanel;
        this.localSimulationPanel = localSimulationPanel;
        setupPanelLayout();

        JPanel boardSection = createBoardSection();
        JPanel localSimulationSection = createLocalSimulationSection();

        add(boardSection, BorderLayout.CENTER);
        add(localSimulationSection, BorderLayout.SOUTH);
    }

    private void setupPanelLayout() {
        setLayout(new BorderLayout(0, 8));
        setBackground(new Color(238, 240, 240));
        setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(new Color(185, 198, 212)),
                BorderFactory.createEmptyBorder(4, 4, 4, 4)
        ));
    }

    private JPanel createBoardSection() {
        JPanel container = new JPanel(new BorderLayout());
        container.add(boardPanel, BorderLayout.CENTER);
        container.add(new BoardTitleLabel("Ricochet Robots Board (16 x 16)"), BorderLayout.NORTH);
        return container;
    }

    private JPanel createLocalSimulationSection() {
        JPanel container = new JPanel(new BorderLayout());
        container.add(localSimulationPanel, BorderLayout.CENTER);
        container.add(new BoardTitleLabel("Local Simulation (Your Private Board State)"), BorderLayout.NORTH);
        return container;
    }
}
