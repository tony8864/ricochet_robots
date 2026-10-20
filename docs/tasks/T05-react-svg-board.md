# T05 — React App Shell and SVG Board Implementation Plan

## 1. Goal and acceptance criteria

Replace the current web placeholder with one mobile-first, read-only local
board screen. Render a deterministic, valid 16×16 fixture through a reusable
React SVG component using the game-engine board, robot, and target types.

T05 establishes the visual board and portrait layout only. It does not add
robot selection, directional controls, movement, undo, reset, bidding, match
phases, room creation, joining, lobby behavior, routing, networking, PWA
caching, or server state.

T05 is accepted when:

- The page presents a single square 16×16 SVG board sized to fit a narrow phone
  viewport without horizontal overflow.
- All 256 cells have a subtle grid, the outer boundary is visible, and the
  central 2×2 blocked area is clearly unavailable.
- Every fixture wall is rendered on the correct cell edge using the engine's
  zero-based row/column and canonical `BlockedEdge` conventions.
- The four robots render at their fixture coordinates and are distinguishable
  by both color and a visible text/symbol cue.
- Colored and wildcard target variants are supported by the component, with
  target semantics distinguishable from robot pieces and not conveyed by color
  alone.
- The rendered target and current round/target context are legible near the
  board, while the board remains read-only.
- The SVG has an accessible name and description, and visual marks do not
  depend on hover.
- The fixture is deterministic, typed with the public game-engine API, and
  validated rather than presented as a production quadrant or guaranteed
  solvable puzzle.
- Existing engine behavior remains unchanged and the implementation adds no UI
  kit, router, state-management framework, testing framework, or other new
  dependency.
- Workspace type checking and the web production build pass.
- Narrow-phone and desktop browser checks confirm a square, legible board with
  no horizontal page overflow.

## 2. Relevant existing code and boundaries

The current web workspace is a minimal React/Vite scaffold:

- `apps/web/src/App.tsx`
  - Renders only a heading and placeholder paragraph.
- `apps/web/src/main.tsx`
  - Mounts `App` in React strict mode and imports the global stylesheet.
  - It currently has a side-effect-only game-engine import that can be removed
    once real typed imports are used by the board and fixture modules.
- `apps/web/src/styles.css`
  - Contains only base typography, page background, and a centered `main`.
- `apps/web/package.json`
  - Already depends on React, React DOM, Vite, and
    `@robot-puzzle/game-engine`; T05 needs no dependency change.
- `apps/web/tsconfig.json`
  - Uses strict TypeScript, the React JSX transform, and DOM types.

The public game-engine surface already provides everything T05 should consume:

- `BOARD_SIZE` for the fixed 16×16 coordinate system.
- `CENTER_BLOCKED_CELLS` for a valid temporary fixture.
- `Board`, `BlockedEdge`, `Coordinate`, `RobotPositions`, `Target`, and
  `GameState` for typed component props and fixture data.
- `assertValidGameState` for validating the checked-in fixture at its boundary.

The UI must consume those types and values without duplicating movement or
target rules. T05 must not change files in `packages/game-engine`.

## 3. Screen and component scope

T05 creates exactly one development-facing screen:

```text
Local board preview
  ├─ game title / brief prototype label
  ├─ round and active-target summary
  ├─ square SVG board
  └─ read-only status message
```

This is not the final home screen or multiplayer navigation. Later tasks own:

- T06: robot selection, directional controls, move count, undo, and reset.
- T12: local thinking, bidding, demonstration, round-result, and match-result
  states.
- T14: nickname entry, create/join room, invite link/code, and lobby.
- T15–T18: authoritative multiplayer state and synchronization.
- T19: PWA caching and connection lifecycle presentation.

The reusable SVG board should survive those later screen changes. `App` may
compose the preview directly in T05; introducing a router or speculative screen
framework is outside scope.

## 4. Proposed SVG coordinate mapping

Use an SVG `viewBox` of `0 0 16 16`, so one engine cell maps directly to one
SVG unit:

```text
engine cell { row, column }
  cell origin = (x: column, y: row)
  cell center = (x: column + 0.5, y: row + 0.5)
```

This direct mapping avoids pixel-specific geometry and keeps the board crisp at
different CSS sizes.

### Grid and boundary

- Draw thin grid lines at integer coordinates from 1 through 15.
- Draw a heavier outer rectangle from `(0,0)` to `(16,16)`.
- Use SVG/CSS sizing with `width: 100%`, `aspect-ratio: 1`, and an appropriate
  maximum width rather than calculating viewport pixels in JavaScript.

### Blocked cells

- Render every `board.blockedCells` coordinate as a filled cell-sized rectangle.
- The deterministic fixture includes the required four center cells.
- Blocked cells are obstacles, not targets or playable spaces, and should be
  visually distinct from the normal grid.

### Walls

Convert each canonical edge into one SVG line:

```text
same row, adjacent columns:
  x = max(first.column, second.column)
  y1 = row
  y2 = row + 1

same column, adjacent rows:
  y = max(first.row, second.row)
  x1 = column
  x2 = column + 1
```

Walls should be noticeably heavier and darker than the grid. The component may
use a small private rendering helper, but it must not reinterpret, normalize,
or validate malformed geometry; the fixture is validated before rendering.

### Robots

- Place each robot at its cell center.
- Use a circle with sufficient contrast and a visible `R`, `B`, `G`, or `Y`
  mark (or an equivalently clear stable symbol) inside it.
- Keep the robot radius comfortably within a cell so walls remain visible.
- Mark robot shapes as non-interactive in T05.

### Targets

- Place the target at its cell center but use a ring/goal-style mark rather
  than a solid robot circle.
- A colored target carries its required robot's color plus the same stable
  letter/symbol cue.
- A wildcard target uses neutral `#E4EDF7` and a `★` symbol.
- Implement rendering for both target variants even though the deterministic
  preview needs only one active target at a time.

Draw order should keep semantics clear:

1. Board background and grid.
2. Blocked cells.
3. Robots.
4. Target, so its rings remain visible when a robot occupies the same cell.
5. Walls and outer boundary, so obstacle edges remain prominent.

## 5. Component API and fixture

Introduce a reusable, presentation-only component:

```ts
export interface BoardSvgProps {
  readonly board: Board;
  readonly robots: RobotPositions;
  readonly target: Target;
}

export function BoardSvg(props: BoardSvgProps): ReactElement;
```

The component receives already-valid state and has no local gameplay state. It
must not call movement functions, mutate props, or infer multiplayer phase.

Create one deterministic preview fixture:

```ts
export const DEMO_GAME_STATE: GameState = {
  board: {
    blockedCells: CENTER_BLOCKED_CELLS,
    walls: [/* a small explicit set of valid sample edges */],
  },
  robots: {
    red: /* valid unblocked coordinate */,
    blue: /* valid unblocked coordinate */,
    green: /* valid unblocked coordinate */,
    yellow: /* valid unblocked coordinate */,
  },
  target: /* one unoccupied colored or wildcard target */,
};
```

Call `assertValidGameState(DEMO_GAME_STATE)` in the fixture module so accidental
invalid edits fail immediately. The fixture must be labeled as temporary demo
content. It is not one of the four original quadrants planned for T08, and T05
must not claim its target is solver-verified or guaranteed solvable.

## 6. Files expected to change during implementation

- Create `apps/web/src/components/BoardSvg.tsx`
  - Define typed props and render grid, blocked cells, target variants, robots,
    walls, boundary, SVG title, and SVG description.
- Create `apps/web/src/fixtures/demoGameState.ts`
  - Define and validate the deterministic temporary board, robot, and target
    fixture.
- Modify `apps/web/src/App.tsx`
  - Replace the workspace placeholder with the single local board preview and
    read-only context text.
- Modify `apps/web/src/styles.css`
  - Add mobile-first page, board container, SVG visual tokens, robot/target
    contrast, narrow-screen sizing, and desktop maximum width.
- Modify `apps/web/src/main.tsx`
  - Remove the obsolete side-effect-only engine import if it is no longer
    needed.
- Optionally modify `apps/web/index.html`
  - Improve the document title only if the existing placeholder title is no
    longer appropriate. Do not add PWA metadata in T05.
- Modify `docs/plan.md` only after implementation and verification
  - Add a T05 Progress Log entry as implemented/awaiting review. Keep the T05
    checklist open until owner approval.

No changes are planned for the game engine, server, shared contracts, puzzles
package, product requirements, architecture, workspace configuration, or
package dependencies.

## 7. Verification strategy

T05 is primarily a visual rendering task. Adding a DOM test stack solely for
this task would introduce dependencies before there is meaningful interaction
behavior, so verification should combine strict compilation/build checks with
targeted browser inspection. T06 can revisit component tests when controls and
state transitions exist.

### Automated checks

Run:

```powershell
pnpm --filter @robot-puzzle/web typecheck
pnpm --filter @robot-puzzle/web build
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

The existing engine and workspace tests must remain green. The web build must
resolve public game-engine imports without adding duplicate domain types.

### Browser checks

Run the local app with:

```powershell
pnpm --filter @robot-puzzle/web dev
```

Inspect at minimum:

1. A narrow phone-sized viewport around 320 CSS pixels wide.
2. A representative modern phone viewport around 390 CSS pixels wide.
3. A desktop viewport.

Verify:

- No horizontal scrolling occurs.
- The board remains square and does not clip.
- All 16 rows and columns align.
- Sample horizontal and vertical walls occupy the expected edges.
- The center 2×2 area is clearly blocked.
- All robots and the target occupy the expected cells.
- Letters/symbols remain readable without relying only on color.
- The target remains visually distinct from robots.
- The page indicates that the preview is read-only and does not display fake
  movement or multiplayer controls.

Real iPhone Safari and Android device acceptance remains T07. T05 should still
use mobile-safe CSS and record any browser-inspection limitation honestly.

## 8. Risks and bounded decisions

There are no blocking gameplay or architecture decisions for T05.

- **Temporary visual style:** Exact branding, final game name, and polished art
  are unresolved. Use simple CSS custom properties and geometric SVG marks that
  are easy to revise; do not generate or introduce final branded assets.
- **Fixture solvability:** T05 is a rendering fixture, not a puzzle-validation
  task. It must not be described as verified solvable. Solver validation remains
  T09–T10.
- **Accessibility:** Letters/symbols satisfy the current non-color requirement
  for the prototype. More extensive screen-reader interaction semantics belong
  with controls and multiplayer state in later UI tasks.
- **SVG line scaling:** Prefer CSS/vector styling that keeps grid and wall
  hierarchy legible across sizes. Confirm visually at the required viewports
  rather than assuming a single stroke width works everywhere.
- **No navigation yet:** The absence of create/join and lobby screens is
  intentional. Adding placeholder navigation in T05 would imply behavior not
  backed by room state and expand the task beyond the approved sequence.

## 9. Ordered implementation steps after approval

1. Add the typed deterministic fixture and validate it with the public engine
   boundary helper.
2. Add `BoardSvg` with direct coordinate mapping and accessible SVG metadata.
3. Render grid, blocked cells, both target variants, robot color-plus-symbol
   marks, walls, and the outer boundary in the documented draw order.
4. Replace the placeholder `App` content with the single read-only preview.
5. Add mobile-first styles for a square board, narrow-phone containment,
   legibility, and desktop maximum width.
6. Run the focused web typecheck and production build.
7. Start the local development server and inspect the required viewport sizes;
   correct only T05 layout/rendering issues.
8. Run workspace tests, workspace type checking, the root build, and
   `git diff --check`.
9. Inspect the final diff for scope expansion and update only the Progress Log
   as implemented/awaiting review. Do not check off T05, commit, or begin T06
   until the owner reviews and explicitly approves those actions.
