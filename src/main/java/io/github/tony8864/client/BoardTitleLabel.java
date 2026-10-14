package io.github.tony8864.client;

import javax.swing.*;
import java.awt.*;
import java.awt.geom.Path2D;

public class BoardTitleLabel extends JLabel {
    public BoardTitleLabel(String text) {
        super(text);
        setOpaque(false);
        setBackground(new Color(223, 230, 237));
        setForeground(new Color(6, 20, 92));
        setFont(getFont().deriveFont(Font.BOLD, 16f));
        setBorder(BorderFactory.createEmptyBorder(8, 12, 8, 12));
    }

    @Override
    protected void paintComponent(Graphics g) {
        Graphics2D g2d = (Graphics2D) g.create();
        try {
            g2d.setRenderingHint(
                    RenderingHints.KEY_ANTIALIASING,
                    RenderingHints.VALUE_ANTIALIAS_ON
            );
            g2d.setPaint(getBackground());
            g2d.fillRoundRect(0, 0, getWidth(), getHeight(), 12, 12);
            int halfHeight = getHeight() / 2;
            g2d.fillRect(0, halfHeight, getWidth(), getHeight() - halfHeight);

            double right = getWidth() - 0.5;
            double bottom = getHeight() - 0.5;
            double radius = 6;
            Path2D.Double outline = new Path2D.Double();
            outline.moveTo(0.5, bottom);
            outline.lineTo(0.5, radius);
            outline.quadTo(0.5, 0.5, radius, 0.5);
            outline.lineTo(right - radius, 0.5);
            outline.quadTo(right, 0.5, right, radius);
            outline.lineTo(right, bottom);
            outline.closePath();

            g2d.setColor(new Color(185, 198, 212));
            g2d.setStroke(new BasicStroke(1f));
            g2d.draw(outline);
        } finally {
            g2d.dispose();
        }
        super.paintComponent(g);
    }
}
