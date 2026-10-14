package io.github.tony8864.client;

import javax.swing.*;
import java.awt.*;

public class GamePanel extends JPanel {

    private final BoardPanel boardPanel;

    public GamePanel(BoardPanel boardPanel) {
        this.boardPanel = boardPanel;
        setLayout(new BorderLayout());
        setBackground(new Color(238, 240, 240));
        setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(new Color(185, 198, 212)),
                BorderFactory.createEmptyBorder(4, 4, 4, 4)
        ));
        add(boardPanel, BorderLayout.CENTER);
        add(new BoardTitleLabel("Ricochet Robots Board (16 x 16)"), BorderLayout.NORTH);
    }
}
