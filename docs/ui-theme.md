# UI Theme

**Status:** Board theme implemented; broader application theme remains under owner review
**Scope:** Shared visual direction for the web application
**Implementation:** The board-specific decisions are implemented in the T05 React/SVG preview.

## 1. Visual direction

The interface uses a minimal, flat, dark-blue visual style.

- Avoid gradients, ornamental textures, and unnecessary depth effects.
- Keep board geometry crisp and easy to read on narrow phone screens.
- Preserve a clear visual hierarchy between subtle grid lines, internal walls,
  and the outer board boundary.

## 2. Approved colors

| Role | Color | Usage |
|---|---|---|
| Page background | `#080F1F` | Background behind the board and surrounding interface |
| Board cell background | `#111F35` | Background of playable board cells |
| Grid lines | `#263852` | Thin, subtle separation between cells |
| Outer boundary | `#7C96B8` | Thick, continuous border around the complete board |
| Internal walls | `#A8BED8` | Thick wall segments between adjacent cells |
| Blocked central area | `#060D19` | Distinct fill for the blocked central 2×2 cells |
| Red robot | `#F45B69` | Filled circle for the red robot |
| Blue robot | `#4DA3FF` | Filled circle for the blue robot |
| Green robot | `#4DD4A0` | Filled circle for the green robot |
| Yellow robot | `#FFD166` | Filled circle for the yellow robot |

Color values must remain semantic design tokens when implemented rather than
being repeated as unrelated literal values throughout components.

## 3. Board treatment

- Every playable cell uses the board cell background.
- Grid lines are thin and visually subordinate to walls.
- The outer boundary is thick, continuous, and distinguishable from the grid.
- Internal walls are thick line segments placed precisely between adjacent
  cells.
- The central 2×2 blocked area uses the blocked-area color and must be clearly
  distinguishable from playable cells.
- The design remains flat: no gradient, texture, bevel, or simulated material
  is currently specified.

Exact stroke widths will be selected during implementation and verified at
narrow-phone and desktop sizes. Their required hierarchy is:

```text
grid lines < outer boundary and internal walls
```

## 4. Robot treatment

- Render exactly four robots as simple filled circles.
- Use the approved red, blue, green, and yellow robot colors.
- Center the corresponding uppercase letter `R`, `B`, `G`, or `Y` inside each
  circle.
- Use dark, bold lettering with sufficient contrast against every robot color.
- Keep each circle slightly smaller than its cell so grid lines and nearby
  walls remain visible.
- Do not use color as the only robot identifier; the centered letter is part of
  the required design.
- Robots remain flat unless a later approved theme revision introduces another
  treatment.

Robot lettering uses `#080F1F`. Each robot has a radius of `0.34` SVG cell
units (a diameter of `0.68` cell units), leaving the surrounding grid and walls
visible.

## 5. Target treatment

- Render one active target on the board.
- Construct the target entirely from SVG elements; do not use an external
  image or icon library.
- Use two concentric outlined rings with a transparent center.
- A colored target uses the approved fill color of its corresponding robot for
  both ring outlines.
- A colored target includes the corresponding uppercase `R`, `B`, `G`, or `Y`
  as an additional visible non-color cue.
- A wildcard target uses neutral `#E4EDF7`, which is distinct from all four
  robot colors and the surrounding board geometry, plus a visible `★` cue.
- Keep the target visually distinct from the robots: targets are outlined
  rings, while robots are filled circles.
- Size and layer the rings so the target remains visible when a robot occupies
  the same cell. The target outline must extend beyond the robot circle and be
  rendered above it.
- Do not add gradients, textures, shadows, or three-dimensional effects.
- The target must have an accessible textual description identifying whether
  it is colored or wildcard.

## 6. Responsive board treatment

- Render exactly 16 rows and 16 columns.
- Keep the board square at every supported viewport size.
- Maximize available width on mobile without introducing horizontal overflow.
- Keep robots, targets, grid lines, walls, and the outer boundary legible at
  narrow phone widths.
- Use a strong continuous outer boundary and cell-edge wall segments; walls
  must never be represented as filled cells.

## 7. Decisions still open

The following visual choices have not yet been provided or approved:

- Primary and secondary text colors outside the board.
- Typeface, font weights, and type scale.
- Page spacing and maximum content width.
- Surface or panel colors, if panels are used.
- Selected, focused, disabled, success, warning, and error states.
- Button and control appearance for later tasks.
- Final game name, logo, and branding.

These items must not be inferred as approved merely from the board palette.
