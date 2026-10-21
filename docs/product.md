# Product Requirements — Multiplayer Sliding-Robot Puzzle

**Status:** MVP product baseline  
**Version:** 0.1  
**Purpose:** Source of truth for product behavior before implementation. This document is not a technical architecture or Codex instruction file.

## 1. Product vision

A free, mobile-first, private multiplayer puzzle game inspired by the *sliding-robot* gameplay of Ricochet Robots. Friends join a room, inspect the same board, mentally find routes to a target, bid how many moves they need, and demonstrate their solution. The experience should feel like playing a physical tabletop puzzle game together.

The game will use an original name, original board layouts, and original visual assets. This document does not establish intellectual-property clearance.

## 2. Target audience and platform

- Small groups of friends, **2–6 players**.
- **Mobile-first Progressive Web App (PWA)**, playable in iPhone Safari and Android browsers without an app-store installation.
- Portrait orientation is the primary design target; desktop browsers are useful for development and testing.
- An internet connection is required for multiplayer.
- Private rooms only. No public matchmaking.

## 3. MVP user journey

1. Player opens the game, enters or reuses a nickname, and creates a private room or joins one.
2. Host shares a room code or invite link.
3. Players join the lobby. The host starts the match when at least two players are present.
4. The room locks to new participants once the match starts.
5. All players see the same 16×16 board, four robots, and active target.
6. Players solve mentally; the board is read-only during thinking and bidding.
7. The first bid starts a 60-second bidding window.
8. After bidding closes, eligible bidders demonstrate in ascending bid order.
9. A successful demonstration awards one point and establishes the robot positions for the next round.
10. A new target is revealed; repeat for 10 rounds.
11. Show results and allow a rematch.

## 4. Board and visual design

- Board is **16×16 cells**, chosen from a catalog of **several original, individually designed full boards**.
- Match variety comes from selecting a complete board; quadrant rotation/rearrangement and procedural wall generation are not part of the MVP.
- Outer board boundaries block movement. The central 2×2 area is blocked.
- Walls are bold, dark lines on **cell edges**; grid lines are subtle.
- Four robots are simple solid circles: **red, blue, green, yellow**. Small distinguishing symbols are desirable for accessibility.
- Each board has **17 targets** at predefined positions: star, crescent moon, upright triangle, and square in each of the four robot colors, plus one neutral vortex wildcard.
- Each target occupies a cell with two perpendicular wall edges meeting at one cell corner. Interior wall segments form perpendicular angles; an unpaired segment is allowed only when exactly one endpoint touches the outer board border and the other endpoint is inside the board. Outer boundaries and edges beside blocked cells remain implicit barriers.
- Colored targets require the matching robot; the vortex accepts any robot. Symbols identify individual targets and do not change movement or completion rules.
- All 17 targets remain visible on the board. Inactive targets are slightly muted; the active target is shown at full brightness with a white rounded outline around its cell, still visible when a robot lands there.
- Board is displayed with scalable SVG and occupies as much phone width as practical.

## 5. Robot movement rules

- A move consists of selecting a robot and one of four cardinal directions.
- The robot slides in that direction until it would hit a wall, the board boundary, the blocked center, or another robot; it stops in the last legal cell.
- Robots cannot overlap, pass through one another, or cross blocked edges.
- A direction that leaves the robot in the same cell is a no-op and does **not** count as a move.
- The active target is solved when the required robot stops on its target cell; for a wildcard, any robot qualifies.
- The board and movement rules are deterministic: identical state and action must produce identical results.

## 6. Match setup and target selection

- A match has **10 rounds**.
- Before match start, show a preview of a valid full board from the catalog. The host may shuffle to another catalog board in the lobby.
- Starting the match locks the selected board and establishes valid initial robot positions.
- Targets are drawn from predefined locations on that board, including wildcard targets; do not repeat a target within the same match.
- Before revealing a target for a round, ensure it is **solvable from the robots' current positions** using a hidden validation mechanism. Do not show the solver or solution to players.
- A prevalidated puzzle library may be used to reduce computational cost, but **later rounds must be checked against the actual carry-forward positions**, not just the initial match positions.
- The board layout stays fixed for the duration of the match.
- **Robot positions are not reset between successful rounds.**

## 7. Thinking and bidding

- At the start of each round, reveal one target. All players see the same board and robot positions.
- Thinking has **no automatic time limit** until a bid is placed.
- During thinking and bidding, nobody may move or privately simulate robots in the game interface.
- A bid is a positive integer representing the **maximum number of moves** the player claims to need.
- The **first accepted bid** starts a **60-second countdown** visible to everyone.
- Other players may submit bids during that countdown.
- Players may **lower** an existing bid, but may not raise it.
- At zero, bidding closes; no late bids are accepted.
- Demonstration order is ascending by final bid count; **earlier bid submission has priority for equal bids**.
- If nobody bids, the host may skip the round (with confirmation). No point is awarded.

## 8. Demonstration and undo

- Only the active bidder controls the board during their demonstration; everyone else watches the same moves live.
- Controls: select a robot, then use **four directional buttons**.
- There is **no demonstration timer**.
- Undo reverses the most recent move; reset attempt restores the robots to their **positions at the start of this round**.
- Undo and reset are free. The current demonstrated move sequence, not discarded moves, is counted against the bid.
- A solution succeeds if the target is reached in **at most** the number of moves bid; fewer moves are allowed.
- Reaching the bid limit without solving does not automatically fail the attempt, because the bidder may undo.
- The bidder can explicitly **Give Up**.
- A disconnected active bidder gets a brief reconnection grace period; after that, the host can skip the abandoned attempt.

## 9. Round completion and robot persistence

- **Successful demonstration:** award the bidder **1 point**. The final positions of **all four robots** become the official starting positions for the next round.
- **Failed or abandoned demonstration:** restore all robots to the positions they had **at the beginning of the round**, then let the next eligible bidder try the same target.
- If all eligible bidders fail or the host skips the round, award no points and keep the round-start robot positions for the next round.
- Each new round reveals a new solvable target from the current official positions.

## 10. Scoring and match end

- Exactly **1 point** is awarded for each successfully completed round.
- No points for failed or skipped rounds.
- After 10 rounds, show a scoreboard sorted by points.
- Equal highest scores are a **shared win**; no tiebreaker.
- A rematch keeps the players in the room, resets scores, and starts a new match with a new valid board/puzzle setup.

## 11. Private rooms and player identity

- No accounts, email addresses, passwords, friends lists, or public matchmaking in the MVP.
- Players choose a nickname; the device may remember it for convenience.
- Each player also has a private session identifier to support reconnecting to their existing seat.
- Room invites support **both a shareable link and a short code**.
- Host starts the match; at least two players are required, and the MVP room cap is six.
- **No late joins:** once the match starts, new participants cannot enter. Previously joined players may reconnect.
- Host authority transfers to another connected player if the host leaves or becomes unavailable.
- A room can expire after a period of inactivity.

## 12. Mobile interaction and feedback

- Portrait layout: board at the top, current round/target and bidding information nearby, controls below.
- During thinking, the board is read-only. During demonstration, only the active player sees enabled movement controls.
- Highlight the selected robot; clearly show the active target, current move count, bid limit, countdown, whose turn it is, and scores.
- Keep movement animations short and responsive.
- Show clear states for disconnected, reconnecting, waiting, success, and failure.
- Prioritize touch target size and legibility on real iPhones.
- Do not depend on preventing iPhone screen sleep; recover gracefully when the browser resumes.

## 13. Reliability and fairness requirements

- The multiplayer backend is authoritative for room membership, bidding order and deadlines, whose turn it is, accepted moves, scoring, and round transitions.
- Clients must not be able to submit demonstration moves outside their turn.
- A reconnecting client receives a current authoritative state snapshot.
- Simultaneous bids and timer expiry must be resolved consistently by the server.
- A failed demonstration must not permanently alter the official round-start positions.

## 14. Explicitly out of scope for MVP

- User accounts, social profiles, friends lists, chat, leaderboards, achievements, matchmaking.
- AI opponents, hints, player-facing solvers, or private board simulation during thinking.
- Monetization, in-app purchases, advertising.
- Custom user-created boards or an in-app level editor.
- Native App Store / Google Play distribution.

## 15. Open implementation details (not blockers to the first prototype)

These should be resolved during architecture or testing, without silently changing the rules above:

1. Initial full-board catalog size, exact wall/target coordinates, and valid initial robot positions for each board.
2. Practical puzzle-validation strategy and acceptable solver runtime; ensure the 10-round target supply is sufficient as positions change.
3. Exact reconnect grace duration, inactivity expiry, and host-skip safeguards.
4. Maximum accepted bid and how bid-submission timestamps are defined for tie priority.
5. Handling a player who leaves permanently after placing a bid.
6. Invite-link routing and session persistence on iPhone Safari.
7. Final original game name, branding, and legal review before wider distribution.

## 16. Acceptance scenarios

- **Movement:** Red moves right and stops immediately before a wall or another robot; a blocked direction does not increase move count.
- **Bidding:** Maria bids 7, Alex bids 6, Maria lowers to 5; after the timer ends, Maria demonstrates first.
- **Equal bids:** Maria submits 6 before Alex submits 6; Maria has first priority.
- **Undo:** A player bids 7, makes 5 moves, undoes 2, and completes in 6 current moves; the attempt succeeds.
- **Failed attempt:** Maria gives up after moving robots; Alex begins from the original positions for that round.
- **Carry-forward:** Alex solves a target with red and blue moved; the next round begins with **both** at their final positions.
- **Wildcard:** Any robot may stop on the wildcard target to solve it.
- **No bids:** Host skips the round; no point awarded and robot positions remain unchanged.
- **Reconnection:** An existing participant reconnects to their seat after room lock; an unrelated new participant cannot join.
- **Match end:** After 10 rounds, tied leaders share the win.
