# T08a — Target Symbols, Model, and Rendering

## Agreed design

- Each full board has 17 targets: star, crescent moon, upright triangle, and
  softly cornered square in red, blue, green, and yellow, plus one neutral vortex.
- Colored targets require their matching robot; the vortex accepts any robot.
- All targets stay visible. Inactive targets are slightly muted; the active
  target is full brightness with a white rounded outline around its cell.
- Render targets behind robots, keeping the cell outline outside the robot
  piece so it remains visible when occupied.

## Scope and implementation steps

1. Add required symbol metadata to the colored/wildcard target union and export
   the supported symbol types/constants.
2. Validate the allowed symbol and robot combinations at runtime. Keep the
   active target in `GameState.target`; completion remains color/position based.
3. Update engine test fixtures and cover all 17 combinations, invalid symbols,
   and symbol-independent completion.
4. Add reusable code-based SVG artwork in `TargetSymbol.tsx`.
5. Give `BoardSvg` the complete target collection and an active target ID;
   render every target and highlight only the active cell. Include target
   symbols, colors, and positions in accessible descriptions.
6. Add 17 temporary target placements to the current demo for visual review.
   Preserve its walls, starting robots, active target position, and known
   two-move solution. Other demo targets are not guaranteed solvable.
7. Test fixture validity, full target rendering, changing the active target,
   layer ordering, and distinct vector artwork.
8. Run workspace tests, type checking, production build, and diff checks;
   review the symbols and active-cell visibility at phone size.

## Boundaries

Production board designs and full-catalog validation belong to T08b. Solver
work remains T09–T10. Host preview/shuffle remains T12/T14. Existing responsive
layout, movement, undo/reset, and robot animation remain in place.

## Verification and review status

Complete. The owner visually reviewed and approved the result. All 111
workspace tests, workspace type checking, and the web production build passed.
Only the existing active demonstration target has a verified solution.
