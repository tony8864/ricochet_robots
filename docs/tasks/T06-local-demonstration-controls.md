# T06 — Local Demonstration Controls Implementation Plan

## 1. Goal and acceptance criteria

Turn the T05 read-only board preview into a small, explicitly labeled local
demonstration. A user can select any robot, move it with four cardinal controls,
see the retained move count, undo moves, reset the attempt, and receive clear
feedback when the active target is reached.

T06 exercises the existing pure game engine from React. It uses one fixed,
fixture-specific bid limit for the local demonstration, but does not introduce
bidding, timers, scoring, rooms, networking, or server-authoritative state.

T06 is accepted when:

- The screen is clearly identified as a local demonstration, not a thinking or
  bidding interface.
- Exactly one robot is selected at all times. The documented default is the
  target-matching robot for a colored target and red for a wildcard target.
- All four robots can be selected through visible semantic controls or by
  tapping the corresponding robot directly on the board.
- The selected robot is identified by letter and text as well as color, and is
  visually highlighted on the board.
- Four directional buttons move only the selected robot through
  `moveAttemptRobot` from the shared game engine.
- A blocked/no-op direction does not change robot positions or increment the
  displayed move count.
- The compact header displays `Your turn` and the move count against the fixed
  local bid limit. The move count is derived from retained attempt history.
- New moves are blocked at the bid limit, but reaching the limit does not end
  the attempt and Undo and Reset remain available.
- Undo restores the immediately previous retained position and removes one
  move from the count.
- Reset restores all four robots to the fixture's round-start positions and
  clears the move history without changing the board or target.
- Reaching the target shows an accessible success message with the final move
  count and prevents further directional moves in that completed local
  attempt.
- Give Up is one direct-action button with no confirmation step. It ends and
  restores the local attempt; Reset makes the fixture playable again.
- The deterministic fixture has at least one known solution exercised through
  the public game-engine API in an automated test. It is still temporary demo
  content, not a production quadrant or solver-generated puzzle.
- Buttons have clear accessible names, visible keyboard focus, and touch
  targets of at least 44 by 44 CSS pixels.
- The phone, tablet, and desktop layouts keep the square board visible without
  horizontal overflow, with controls below the board.
- Existing engine tests, workspace type checking, the web production build,
  and the new web tests pass.

## 2. Product and architecture boundaries

The product permits board interaction only while an active bidder is
demonstrating. T06 therefore presents an isolated **local demonstration mode**.
It must not suggest that players may simulate moves during the later thinking
or bidding phases.

The shared engine remains the source of truth for movement and attempt rules:

- `createAttempt` anchors the round-start robot positions.
- `moveAttemptRobot` applies sliding movement and excludes no-ops from history.
- `getAttemptMoveCount` derives the retained move count.
- `undoAttempt` reverses the latest retained move.
- `resetAttempt` restores every robot to the round-start positions.
- `isTargetComplete` handles colored and wildcard targets.

React owns only temporary local UI state: the selected robot and the current
local attempt. T06 must not copy movement rules into components or change the
game-engine data structures for visual convenience.

Success and Give Up end the current local attempt for movement purposes.
Because T06 has no round state machine, Reset may start the same fixture again
for development and review. Give Up is deliberately a single immediate action
in this local prototype. The authoritative multiplayer server will own real
success, failure rollback, bidders, and round transitions in later tasks.

## 3. Current implementation

T05 provides:

- `apps/web/src/components/BoardSvg.tsx`
  - A reusable presentation-only SVG board accepting `Board`,
    `RobotPositions`, and `Target`.
- `apps/web/src/fixtures/demoGameState.ts`
  - A validated deterministic rendering fixture.
- `apps/web/src/App.tsx`
  - A single read-only board preview.
- `apps/web/src/styles.css`
  - Mobile-first board styling that scales across phone, tablet, and desktop
    widths.

T04 already implemented and tested every engine operation required by T06.
No game-engine source change is expected.

The current demo target was selected for visual review and has not been proven
solvable. Before implementation, either prove a short solution for the current
fixture through the engine or make the smallest fixture-only adjustment needed
to create a deterministic known solution. Record that solution only in tests;
do not expose hints in the UI.

## 4. Proposed local state design

Keep event handling out of the SVG geometry component. Add a small pure local
demonstration reducer or equivalent pure transition module:

```ts
interface LocalDemonstrationState {
  readonly selectedRobot: RobotId;
  readonly attempt: AttemptState;
  readonly outcome: 'active' | 'success' | 'given-up';
}

type LocalDemonstrationAction =
  | { readonly type: 'select-robot'; readonly robotId: RobotId }
  | { readonly type: 'move'; readonly direction: Direction }
  | { readonly type: 'undo' }
  | { readonly type: 'reset' }
  | { readonly type: 'give-up' };
```

The transition layer receives the fixture board and target, delegates every
rule-bearing operation to the engine, and returns immutable state.

Approved behavior:

- Start with the colored target's matching robot selected. For a wildcard
  target, use red as the stable default.
- Keep the selected robot after a successful move, no-op, undo, or reset so
  repeated movement is convenient.
- Store the fixed local bid limit as fixture data separate from `GameState`;
  choose its value only after a short solution is verified through the engine.
- Ignore new movement actions when the retained move count equals the bid
  limit. Do not mark the attempt failed or completed merely because the limit
  has been reached.
- Continue to allow selection changes, Undo, and Reset at the bid limit.
- Derive completion with `isTargetComplete`; do not store a second completion
  flag that could drift from robot positions. Set the terminal outcome only in
  response to the move that reaches the target within the limit.
- Once complete, ignore new selection and movement actions. Keep Reset
  available so the local fixture can be replayed.
- Give Up immediately restores the round-start positions, clears history, and
  sets the terminal `given-up` outcome without displaying a confirmation.
- Reset restores round-start positions, clears history, and returns either
  terminal outcome to `active`.
- Disable Undo when history is empty. Keep Reset enabled after success or Give
  Up even when the restored move count is zero.

These are reversible local-UI choices and do not define future server phase
behavior.

## 5. Screen and controls

The screen remains a single development-facing page:

```text
Compact header: Your turn / Moves N of BID_LIMIT
Square SVG board
Robot selection buttons: R B G Y
Direction pad: Up / Left / Right / Down
Undo, Reset, and Give Up buttons
Live status / target feedback
```

### Robot selection

- Render four native `button` elements below the board.
- Keep the four circular selectors in one horizontal row ordered R, B, G, Y.
- Each button includes the robot letter and an accessible name such as
  `Select blue robot`.
- Use `aria-pressed` to expose the current selection.
- Match the existing robot colors while retaining the visible letters.
- Pass the selected robot ID to `BoardSvg` only for presentation. Add a
  non-color selection treatment such as a contrasting outline around the
  selected robot.
- Add pointer/touch selection to each rendered SVG robot through an
  `onRobotSelect` callback. The native selector buttons remain the primary
  keyboard and assistive-technology mechanism.
- Selection never changes robot positions or move history.

### Direction controls

- Use four native buttons arranged as a compact directional pad.
- Center Up on the first row; arrange Left, Down, and Right on the row below.
- Use visible arrow symbols together with explicit accessible names such as
  `Move selected robot up`.
- Disable all four at the bid limit and after success or Give Up.
- Desktop arrow-key movement is an optional enhancement. Implement it only if
  it does not interfere with focused controls, text inputs, or natural page
  scrolling; otherwise defer it without blocking T06.

### Attempt actions and feedback

- Display `Your turn` and `Moves: N / LIMIT` in a compact header immediately
  above the board. `N` comes from `getAttemptMoveCount` and the limit comes
  from the checked-in demo fixture.
- Provide native `Undo`, `Reset`, and `Give Up` buttons below the D-pad.
- Announce selection, no-op feedback, resets, and target success in a concise
  `aria-live="polite"` status region.
- A no-op may state that the selected robot is blocked, but it must not be
  represented as a retained move.
- On completion, display `Target reached in N move(s)` and leave reset
  available to replay the local demonstration.
- At the limit, explain that no additional move can be made and keep Undo and
  Reset usable; do not automatically end the attempt.
- Give Up acts immediately, restores the initial robot positions and move
  count, and displays `Demonstration given up`. Reset returns to an active
  attempt.
- Do not show scores, a countdown, another player, or a round transition.

## 6. Component changes

Extend `BoardSvg` with one optional presentation prop:

```ts
export interface BoardSvgProps {
  readonly board: Board;
  readonly robots: RobotPositions;
  readonly target: Target;
  readonly selectedRobot?: RobotId | null;
  readonly onRobotSelect?: (robotId: RobotId) => void;
}
```

The component continues to render positions supplied by its parent and remains
free of attempt state and movement calls. The selected value adds only a class
or data attribute to the matching robot group for styling. The optional
callback reports pointer/touch selection without applying game rules.

`App` initializes the reducer from `DEMO_GAME_STATE.robots`, passes the
attempt's current robot positions to `BoardSvg`, renders the controls, and
derives move count and completion through engine helpers.

Small presentational components such as `RobotSelector` or `DirectionPad` may
be extracted if that keeps `App` readable. Do not introduce a component
library, global state framework, router, or form package.

## 7. Test strategy

T06 introduces meaningful local interaction state, so add a web test script
and the workspace's existing Vitest version as a web development dependency.
Do not add a DOM testing library solely for this task.

Test the pure local demonstration transitions with deterministic fixtures:

1. Initial state selects the target-matching robot (or red for a wildcard), has
   zero moves, and uses round-start positions.
2. Selecting each robot changes only the selected ID and never the move count.
3. A valid directional action moves the selected robot and increments count.
4. A blocked/no-op action preserves positions and count.
5. Undo reverses only the latest retained move and decrements count.
6. Reset restores every round-start robot and clears history.
7. Movement is rejected at the fixed bid limit while selection, Undo, and
   Reset remain available and the attempt remains active.
8. A documented sequence completes the demo target within its limit through
   `isTargetComplete`.
9. Further movement is ignored after completion while Reset starts a fresh
   local attempt.
10. Give Up immediately restores the round-start state, sets the terminal
    outcome, and Reset makes the demonstration active again.
11. Inputs and the checked-in fixture remain unmutated.

Use browser inspection for rendered semantics and layout:

- Every control is reachable by keyboard and has a visible focus indication.
- Robot buttons expose their pressed state.
- Pointer/touch selection on an SVG robot updates both selection outlines.
- Disabled controls are visibly and semantically disabled.
- Selection and target completion are understandable without color.
- The live region reports the current outcome without duplicating excessive
  board detail.
- Touch targets are at least 44 by 44 CSS pixels.
- At 320 px and 390 px phone widths, controls remain below the square board
  without horizontal scrolling, and natural vertical scrolling remains
  available.
- Never overlay selectors, the D-pad, or attempt actions on the SVG board.
- At representative tablet and desktop widths, the larger T05 board remains
  centered and controls do not become excessively spread out.

Run:

```powershell
pnpm --filter @robot-puzzle/web test
pnpm --filter @robot-puzzle/web typecheck
pnpm --filter @robot-puzzle/web build
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

## 8. Expected files

- Create `apps/web/src/localDemonstration.ts`
  - Pure state creation, actions, and transitions composed from engine helpers.
- Create `apps/web/src/localDemonstration.test.ts`
  - Deterministic selection, move, no-op, undo, reset, completion, and
    immutability coverage.
- Modify `apps/web/src/App.tsx`
  - Own local demonstration state and render status and controls.
- Modify `apps/web/src/components/BoardSvg.tsx`
  - Accept and render the optional selected-robot treatment.
- Modify `apps/web/src/fixtures/demoGameState.ts` only if required
  - Establish a known-solvable temporary fixture and export its fixed local
    bid limit without presenting either as a production puzzle rule.
- Modify `apps/web/src/styles.css`
  - Add responsive control layout, 44-pixel touch targets, pressed/disabled
    states, visible focus, selected-robot highlight, and success feedback.
- Modify `apps/web/package.json`
  - Add the web test scripts and Vitest development dependency.
- Modify `pnpm-lock.yaml`
  - Record the web workspace's declared test dependency.
- Modify `docs/plan.md` only after implementation and verification
  - Add a T06 Progress Log entry as implemented/awaiting owner review. Keep the
    T06 checklist open until owner approval.

No changes are planned for `packages/game-engine`, `apps/server`,
`packages/shared`, `packages/puzzles`, product requirements, architecture, or
deployment configuration.

## 9. Risks and decisions for review

There is no blocking gameplay, fairness, security, or architecture decision.

- **Known-solvable fixture:** T06 needs a demonstrated solution, unlike T05's
  visual-only fixture. Prefer proving the current fixture first; adjust only
  temporary fixture geometry or target position if necessary.
- **Success handling:** The real game will immediately transition under server
  authority. T06 freezes local movement on success and permits Reset only as a
  preview convenience.
- **Selection behavior:** The approved deterministic default selects the
  colored target's robot, or red for a wildcard. Retaining selection after
  undo/reset minimizes unnecessary taps.
- **Give Up:** The approved local behavior is one immediate button with no
  confirmation. It restores positions and ends the attempt; Reset reactivates
  the fixture.
- **Bid limit:** The fixed fixture value exists only to exercise demonstration
  behavior. It does not implement bidding or establish a production maximum.
- **Testing dependency:** Adding Vitest to the web workspace is justified by
  the first stateful UI behavior. A DOM test stack remains deferred until a
  later task demonstrates the need.
- **Device verification:** Responsive browser checks belong to T06; real
  iPhone Safari and Android touch testing remains the acceptance focus of T07.

## 10. Ordered implementation steps after approval

1. Establish and test a short deterministic solution for the demo fixture,
   making the smallest fixture-only adjustment if needed.
2. Add the pure local demonstration state transitions and focused Vitest
   coverage.
3. Add the optional selected-robot presentation prop to `BoardSvg`.
4. Replace the read-only preview status with the compact turn/bid header,
   robot selection, direction, Undo, Reset, Give Up, and accessible feedback
   controls in `App`.
5. Add mobile-first control, focus, disabled, selection, and success styles.
6. Run focused web tests, type checking, and the production build.
7. Inspect keyboard behavior and phone, tablet, and desktop layouts in a
   browser; correct only T06 interaction or layout issues.
8. Run the full workspace test, typecheck, build, and diff checks.
9. Inspect the final diff for scope expansion and update only the Progress Log
   as implemented/awaiting review. Do not check off T06, commit, or begin T07
   until the owner reviews and explicitly approves those actions.
