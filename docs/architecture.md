# Technical Architecture — Multiplayer Sliding-Robot Puzzle

**Status:** Proposed architecture for review  
**Version:** 0.1  
**Companion:** `docs/product.md` (product rules are authoritative)  
**Audience:** Developer and Codex  
**Scope:** Mobile-first private multiplayer PWA; not an implementation task list.

## 1. Goals and constraints

Build a small, maintainable multiplayer game that two to six friends can play in iPhone Safari and Android browsers.

Architecture priorities, in order:
1. Correct deterministic game rules and authoritative shared state.
2. Reliable reconnection and fair bid ordering/deadlines.
3. Excellent portrait phone experience and simple invite flow.
4. Easy local development, testing, and incremental work with Codex.
5. Low operational cost and minimal infrastructure.

Non-goals: public matchmaking, accounts, chat, large-scale analytics, AI opponents, or a separate real-time physics engine.

## 2. Proposed stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React + TypeScript + Vite | Small, familiar web stack; easy mobile browser testing |
| PWA | Web app manifest + service worker | Home-screen installation and cached app shell; multiplayer still needs internet |
| Board rendering | SVG | Crisp 16×16 grid, walls, targets, robots; scales to phones |
| Styling | CSS with responsive layout | Avoid unnecessary UI frameworks initially |
| Game engine | Pure TypeScript package | Deterministic, portable, independently testable |
| Shared contracts | TypeScript types + runtime validation | Prevent malformed network messages and version drift |
| Realtime backend | Cloudflare Worker + Durable Object per room | Room-scoped authoritative state and WebSocket connections |
| Persistent room state | Durable Object storage | Recover from restarts/hibernation; no external database initially |
| Puzzles | Versioned, checked-in data and offline validation tools | Original full-board catalog and predictable setup |
| Testing | Vitest; browser E2E later (e.g. Playwright) | Engine and state machine first; phone browser verification |
| Package management | pnpm workspaces | Simple monorepo without an orchestration framework |

These are preferred implementation choices, not proof that every hosting plan is free. Check current provider limits and billing before deployment.

## 3. Logical architecture

```text
iPhone Safari / Android browser
          |
          | HTTPS (load PWA, create/join room)
          | WebSocket (commands, snapshots, events)
          v
Cloudflare Worker (routing, room code resolution)
          |
          v
Durable Object: one authoritative instance per room
  - player seats and reconnection
  - phase/state machine
  - bids and server deadlines
  - legal demonstration commands
  - score and round transitions
  - persistence and broadcasts
          |
          +--> shared game engine (pure functions)
          |
          +--> versioned board/target catalog
```

The shared engine is a library imported by the server (and optionally by the frontend for non-authoritative previews during demonstrations). It is **not** a separately deployed service.

## 4. Suggested repository structure

```text
robot-puzzle/
  apps/
    web/                  # React PWA and SVG board
    server/               # Cloudflare Worker and Durable Object
  packages/
    game-engine/          # pure movement and target rules
    match/                # pure match state and transition contracts
    shared/               # message schemas, shared state types
    puzzles/              # full-board catalog, target data, validation tools
  docs/
    product.md
    architecture.md
  AGENTS.md
  package.json
  pnpm-workspace.yaml
```

Keep packages separate by responsibility, not for their own sake. Do not introduce a database ORM, message broker, event-sourcing platform, or monorepo orchestration framework unless a concrete need arises.

T11.1 establishes `@robot-puzzle/match` as the pure lifecycle boundary shared by
the future local prototype and authoritative server. It depends on engine types
and puzzle/round-setup types; neither lower-level package depends on match. The
package exports readonly phase-specific state, command/context, and
transition-result contracts plus the fixed round/window constants. T11.2 adds
`createMatch` and `prepareMatchRound`: validated creation and an explicit T10 call
followed by the internal preparation-acceptance handler. T11.3 adds the incremental
`transitionMatch` entry point for player bids and controller time/preparation
commands. T11.4 extends it to active-bidder move/undo/reset/give-up commands and
atomic success/exhausted-bidder resolution. T11.5 completes the full `MatchAction`
contract with host-confirmed no-bid skip and explicit controller advancement.
Final standings/shared winners are derived from Finished state. T11.6 verifies
the assembled pure lifecycle with deterministic two-/six-player ten-round tests,
real T10 selection, per-action invariants, and immutable sequence replay.

Creation owns copies of roster/board data and starts in Preparing. Preparation
captures match/round/board/positions/used-ID context and rejects stale results,
including results from before a completed round that left robots unchanged.
Acceptance verifies target identity/start positions and replays the proof, then
atomically enters Thinking with the target marked used and copied round-start
positions. Solver proofs are discarded from ordinary match state. Deferred or
unavailable results keep Preparing and preserve official state; retries remain
explicit and no background recovery is introduced.

The reducer takes `(state, action)` and returns `{ state, outcome }`.
`MatchAction` binds a player command to trusted actor/host/time context, or a
controller command to trusted time context. Internal round preparation is not a
player command. Phase handlers implement the reviewed transition
table in `docs/tasks/T11-1-state-and-transition-design.md`, preserving the
separation between official, round-start, and provisional attempt positions.
Time, networking, identity authentication, and scheduling remain caller-owned.
These TypeScript contracts are not runtime network validation.

The T11.3 pipeline validates supported action/context shape, normalizes overdue
bidding using supplied authoritative time, then applies actor/phase/domain checks.
Deadline normalization is shared by all action handlers. The first bid starts one
60-second absolute window; revisions preserve deadline and original tie priority.
Expiry freezes final bid order and creates one fresh attempt from round start.
A late bid is rejected while its returned state retains any due expiry transition.
Repeated time checks cannot restart a demonstration; no other phase has a timer.
The reducer itself performs no target search, scheduling, or clock reads.

Demonstration handlers reuse the engine's attempt/history/completion functions.
Only the frozen queue's active bidder can act; no-ops are free, and exceeding the
retained-move limit rejects a move without ending the attempt. Give-up creates
the next attempt from the immutable round start. A shared internal completion
helper atomically records outcomes/counts, awards one point on success, and copies
all four final positions into official state. Failed attempts never commit their
positions. Result state contains no live attempt/queue and cannot be undone or
scored again. T11.5 reuses this helper for no-bid skips rather than awarding on
advance. Round Result stays stable until controller advance: rounds 1–9 enter
Preparing without searching; round 10 enters Finished without an eleventh target.
The derived `getMatchResults` selector orders scores and returns all tied leaders,
including all-zero shared winners. No duplicated standings are stored in state.

T12.1 connects the existing web demonstration through a small local controller in
`apps/web/src/local`. It holds one T11 match snapshot, separate host/acting seats,
and an injected clock; React subscribes through `useSyncExternalStore` and owns
only presentation selection. Player actions delegate to the public reducer and
always retain its returned state, including rejected actions with due expiry.
A dev-only starter is loaded and run once in `main.tsx` before rendering: real
creation, bounded preparation, bids, and supplied expiry, with no proof playback.
Later phase panels remain placeholders. Production currently shows a placeholder
rather than exposing the temporary player simulation. This adapter supplies no
network authentication, server scheduling, persistence, or reconnect guarantees.

## 5. Game-engine boundaries

The game engine owns **rules of geometry and movement**, not multiplayer permissions.

Inputs:
- Immutable 16×16 board definition: blocked cells and blocked edges.
- Robot positions keyed by stable robot IDs/colors.
- Target location and target requirement (color or wildcard).
- Proposed action: robot ID and direction.

Outputs:
- New robot positions, or a no-op/invalid result.
- Whether the target has been reached.
- Enough information for deterministic move counting and tests.

Rules:
- A robot slides to the last legal cell before a wall, boundary, blocked center, or another robot.
- It cannot cross walls, overlap robots, or stop early.
- A move that changes no position does not increment the count.
- The engine must not know which player is acting, what they bid, or how much time remains.
- Treat the board and input state as immutable; return new state rather than mutating shared objects.

Represent walls as **blocked edges** (e.g. normalized horizontal/vertical segments or per-cell direction masks). Ensure the two sides of an interior edge cannot disagree. Use integer row/column coordinates and a single documented coordinate convention.

## 6. Full-board catalog and puzzle validation

- Store several original, individually designed 16×16 boards in `packages/puzzles`, with stable board IDs, complete wall/target coordinates, and valid initial robot positions.
- Select whole catalog boards rather than rotating/rearranging quadrants or generating wall layouts at runtime.
- Validate the agreed board-design geometry: each target has a perpendicular wall pair at one cell corner; interior wall segments form angles, except a lone segment may meet the outer border at exactly one endpoint.
- Validate catalog IDs, wall coordinates, outer boundaries, central 2×2 blockage, target locations, and distinct legal robot starts.
- Preview the selected board in the lobby. The server owns the selection and accepts shuffle requests only from the host before match start; all clients receive the same selected board.
- Lock the selected board at match start and keep it unchanged for all 10 rounds.
- Store target identifiers so the same target is not used twice in a match.
- Every catalog board has 17 targets: each combination of four robot colors and four symbols (`star`, `crescent`, `triangle`, `square`), plus one wildcard with `symbol: 'vortex'`.
- The engine target union requires a colored symbol and robot ID for colored targets, or the vortex symbol for a wildcard. The engine's `GameState.target` remains the active target; completion depends on the robot requirement and position.
- The SVG renderer receives the complete target collection plus the active target ID. Reusable vector artwork renders behind the robots, with a white cell outline for the active target and muted inactive targets.

**Critical product rule:** The robot positions after a winning demonstration carry into the next round. Consequently, an offline prevalidated *initial* configuration is not enough to guarantee later targets are solvable.

Proposed strategy:
1. Offline-validate board templates and initial robot placements for quality.
2. At each round boundary, evaluate unused targets against the **current** robot positions.
3. Reveal only a target confirmed solvable; prefer a bounded search with a measured time budget.
4. If validation cannot finish or no suitable target exists, use an explicitly designed fallback (e.g. a prevalidated continuation or a controlled regeneration policy) **before revealing a target**; never silently show an unverified puzzle.
5. Track solver performance during development. Optimality is not required for the player-facing rules; proof of solvability is sufficient.

**Architecture risk to resolve before multiplayer implementation:** A naïve exhaustive solver may be too slow. Benchmark on representative boards and decide whether to precompute continuation-safe target sets, cache results, or use another bounded validation strategy. Do not promise instantaneous runtime solvability without measurements.

The T10 pure round-setup API lives at `@robot-puzzle/puzzles/round-setup`.
It validates a full-board entry and all current positions, excludes used and
already-satisfied targets, and examines candidates in an externally supplied
order. The caller owns shuffling; the pure selector owns no randomness or clock.
The first solution is replayed through engine movement before returning copied
round-start positions and target data. Its internal solution proof is a separate
field and must never be included in a public room snapshot.

The explicit provisional policy allows 50,000 expansions / 150,000 stored states
per candidate and 200,000 actual expansions across a selection call, including
unsuccessful searches. An inconclusive candidate can be followed by another
unused candidate within the remaining budget. Deferred results distinguish
untested candidates from candidates all examined without conclusive validation;
exhaustive failure and lack of eligible targets remain separate outcomes.
Nothing is revealed or committed by selection. The later match state machine
records the selected ID as used atomically when revealing the round, regardless
of its eventual success, failure, or skip.

T10 implements the bounded selector and its immediate alternate-target fallback.
Scheduling recovery when no target is verified, its player feedback, and actual
server-runtime limits remain unresolved before live integration. Preserve the
official state and keep the next target unrevealed in that case. There is no
automatic reset, board replacement, target reuse, or ten-round continuation
guarantee. See `docs/benchmarks/T10-round-setup.md` for complete-call measurements.

## 7. Authoritative room state

Each Durable Object owns one room. A conceptual snapshot contains:

```text
RoomState
  roomId, schemaVersion, revision
  hostSeatId
  seats[]: seatId, nickname, sessionCredentialHash?, connectionStatus, score
  roomStatus: lobby | playing | finished
  selectedBoardId         # lobby preview; locked into the match on start
  match:
    boardId / board definition
    robots (official committed positions)
    usedTargetIds[]
    roundIndex (1..10)
    activeTargetId
    roundStartRobots
    phase
    bids[]
    bidDeadlineAt?          # absolute server timestamp
    activeAttempt:
      seatId
      bidLimit
      robots
      moveHistory[]
    lastResult?
```

This is a conceptual model, not a finalized schema. Secrets or reusable credentials must **not** be included in snapshots broadcast to all clients.

### Phases

```text
LOBBY
  -> THINKING
  -> BIDDING (first accepted bid starts 60-second server deadline)
  -> DEMONSTRATING (one bidder at a time)
  -> ROUND_RESULT
  -> THINKING (next target) ... 
  -> MATCH_RESULT
  -> LOBBY / REMATCH
```

Additional paths:
- THINKING -> ROUND_RESULT if host skips an unbid round.
- DEMONSTRATING -> DEMONSTRATING with next eligible bidder after failure.
- DEMONSTRATING -> ROUND_RESULT when successful or all eligible bidders fail.
- Any active phase -> reconnect/wait handling without losing authoritative state.

Define transitions explicitly; never infer phase from the presence of UI elements.

## 8. Bids, deadlines, and fairness

- The server accepts only positive integer bids from seated players while bidding is open.
- First accepted bid creates an **absolute server-side deadline** 60 seconds later.
- Existing bids may be lowered, not raised.
- No bids accepted at or after the deadline; client clocks are informational only.
- Order demonstrations by final bid count; for ties use the **timestamp/order of the player's first accepted bid**, not the latest reduction. This tie detail should be confirmed as a product convention.
- A bid command must be processed atomically by the room instance to prevent simultaneous ordering ambiguity.
- A room alarm or equivalent server-side scheduled mechanism should advance the phase at expiry; also enforce the deadline on every incoming command and on reconnect. Do not rely on a browser timer.

## 9. Demonstration, undo, and round commitment

- Only the active bidder may send movement, undo, reset, or give-up commands.
- Server checks phase, seat identity, selected robot, direction, and bid limit.
- The active attempt begins from a copy of `roundStartRobots`.
- Accepted non-no-op moves append to the current move history.
- Undo pops the last move and restores the previous positions.
- Reset clears history and restores `roundStartRobots`.
- If the target is reached within the bid limit, commit **all four** final robot positions to the official room state, award one point, and complete the round.
- Failed, skipped, or abandoned attempts never commit their provisional positions.
- The next bidder starts again from the same `roundStartRobots`.
- If all bidders fail, the next round starts with the unchanged official positions.

To avoid accidentally committing an over-limit move, reject new moves that would exceed the bid limit while still allowing undo/reset/give-up. No-op actions do not count.

## 10. Network protocol

Use a small typed command/event protocol over WebSockets.

The owner approved the concrete T13.1 design on 2026-10-26 in
`docs/tasks/T13-1-message-inventory-and-protocol-design.md`; it supersedes the
illustrative message names below. It uses same-origin HTTPS bootstrap plus WSS,
an anonymous HttpOnly/Secure/SameSite=Lax browser-session cookie mapped to room
seats, full explicitly projected public snapshots, and separate private binding
replies. Client JSON never supplies identity, trusted time, or controller actions.
Continue is `round.continue`; the finished host action is
`match.returnToLobby`, not immediate round-one creation. Departure commands and
live preparation retry policy remain deferred, not implicitly supported.

T13.2 adds readonly client request contracts and pure structural/JSON validation
to `packages/shared`, with engine enum reuse and type-only match command reuse.
The package depends on those lower layers, never the reverse. Strict field,
context, UUID, Unicode normalization, and 4 KiB UTF-8 input bounds do not provide
authentication or authorization. Cookie/session handling, transport enforcement,
matching context to current room state, durable retries, and server time remain
later server responsibilities.

T13.3 implements exact phase-specific public room-state types, allowlist projection,
and bounded runtime parsing in shared. It reuses catalog geometry validation through
the puzzles workspace without solver execution in the parsing path. Every nested
output is copied; private credentials, history and solver data are not broadcast.
Attempt metadata is bound to the current match/round/bidder, preparation activity
has an explicit safe status mapping, and success positions are checked against
the target using the engine. These functions neither persist nor authorize state.
T13.4 implements the eight approved server-message envelopes and strict parsers,
including send-time metadata, nested state, binding consistency and revision
ordering. Public unions/boundary validation accept only snapshots and room closure;
private session/membership/result/error replies are not room broadcasts. JSON
parsing enforces 65,536 UTF-8 bytes before parsing; actual transport must still
bound raw frames before allocating/decoding them. No cookie values are JSON fields.
These checks do not authenticate a server, apply revision reconciliation, or
implement command deduplication, storage, timers, sockets, or live reconnection.

T13.5 completed the protocol audit/handoff on 2026-10-27 without a runtime design
change. Two-/six-player deterministic scripts compose actual T11/T10 with both
request/reply parsers; all 378 shared / 922 workspace tests, type checks and build
passed. Dependency/source checks confirm the shared boundary stays platform-free
and acyclic. T14–T18 still own authenticated transport, state persistence,
contextual authorization, deduplication and client reconciliation/reconnection;
the shared README lists the remaining implementation gates. No live multiplayer
claim follows from passing pure contract tests.

Client commands (illustrative):
- `room.create`, `room.join`, `room.start`, `room.leave`
- `board.shuffle` (host, lobby only; selects another catalog board)
- `bid.submit`
- `round.skip` (host, when allowed)
- `attempt.move`, `attempt.undo`, `attempt.reset`, `attempt.giveUp`
- `match.rematch`

Server messages:
- `room.snapshot` (authoritative state and revision)
- `room.updated` / focused domain events
- `command.accepted` / `command.rejected` with a reason
- `connection.status` / `room.closed` where appropriate

Every command includes a unique command ID. The server validates its shape and the authenticated seat, handles duplicates safely, and increments a monotonic room revision on accepted state changes. Client UI reconciles against authoritative revisions rather than assuming optimistic actions succeeded.

**Privacy:** Public room snapshots contain nicknames, scores, bids, positions, and phases, but not session credentials or raw invite-management secrets.

## 11. Room creation, invite links, and identity

- Create a room with a short human-readable code and a shareable HTTPS invite URL.
- A user enters a nickname and receives a server-issued **unguessable seat credential**; nickname alone is not proof of identity.
- Store credentials in a suitable browser storage mechanism with an explicit threat model; transmit only over HTTPS/WSS. Consider secure HttpOnly cookies where practical.
- After match start, reject new seats but allow existing seats to reconnect with their credential.
- Room codes must be collision-checked and rate-limited; avoid treating short codes as secure authentication.
- Keep room/seat state long enough for brief disconnects and app backgrounding.
- Transfer host privileges deterministically when necessary (e.g. oldest connected eligible seat).
- Expire idle rooms and purge session data according to a defined retention policy.

## 12. Reconnection and browser lifecycle

Mobile Safari may suspend background tabs and drop WebSockets. Design for this as normal behavior.

- On resume, reconnect with the seat credential and room ID.
- Server returns a complete, current snapshot including phase, deadline, positions, active bidder, and scores.
- Reconstruct UI from that snapshot; do not replay all past animation frames.
- Countdown displays time remaining using the server deadline plus an estimated clock offset; server remains authoritative.
- Preserve official state when all clients temporarily disconnect; define room expiry separately.
- Provide a visible reconnecting state and disable state-changing controls until synchronized.

## 13. PWA UX and offline behavior

- The app shell and static assets may be cached for quick launch.
- **Live multiplayer is online-only.** If offline, show an understandable connection message; do not permit offline bids or moves that would later be merged.
- Board is read-only during thinking/bidding.
- During demonstration, show selected robot, directional controls, move count, undo, reset, and give up.
- Keep the 16×16 SVG square and legible in portrait; avoid accidental page scrolling while interacting with controls.
- Use color plus shape/symbol to identify robots and targets.
- Invite links must work directly in iPhone Safari, with manual room code as fallback.

## 14. Testing strategy

**Unit tests (game engine)**
- Walls, edges, center blockage, robot collisions, no-op moves.
- Full-board catalog IDs, geometry, targets, and legal initial robot positions.
- Matching-color and wildcard target completion.
- Immutable state and deterministic replay.

**State-machine tests (server logic)**
- First bid starts timer; lowering; rejected raises and late bids.
- Tie ordering, simultaneous bids, and expiry boundary.
- Only active bidder can move.
- Undo/reset, failure rollback, next bidder.
- Successful carry-forward of all robot positions.
- No-bid host skip, 10-round termination, tied winners.
- Room lock, reconnect, host transfer, expired room.
- Host-only lobby board shuffle and fixed board selection after match start.

**Integration tests**
- Two clients receive identical revisions and state.
- Duplicate/retried commands do not apply twice.
- Reconnect after backgrounding or a dropped WebSocket.
- Worker/object restart does not lose a live room's essential state.

**Manual device tests**
- iPhone Safari and Android Chrome, portrait, small screens.
- Share invite link, join via code, play an entire match.
- Background/lock/unlock phone during bidding and demonstration.
- Verify readable walls, targets, and accessible button sizes.

## 15. Development and deployment approach

1. Implement and test pure game engine.
2. Render a local interactive SVG board with controls and undo/reset.
3. Implement local match state machine and test 10-round progression.
4. Validate full-board catalog data and benchmark puzzle solvability checks.
5. Implement authoritative room server and typed protocol.
6. Add private lobby, bidding, synchronized demonstrations, reconnection.
7. Test on real iPhone/Android devices.
8. Deploy web frontend and Worker, configure HTTPS and invite URL, monitor errors.

Local development should allow running the web app and server independently. Use environment variables for deploy-specific values, never hardcode secrets, and maintain a documented way to run tests and preview builds.

## 16. Operational and security basics

- Rate-limit room creation, joining, and commands.
- Validate all network input at runtime; TypeScript types alone do not protect the server.
- Authorize every command by seat and phase.
- Use HTTPS/WSS; do not expose private seat credentials in broadcast messages or logs.
- Persist essential state before or consistently with broadcasting accepted transitions.
- Keep logs minimal: room ID, revision, phase, error category; avoid sensitive tokens.
- Track puzzle-validation timeouts and reconnect failures.
- Set sensible room expiration and resource budgets.
- Verify current Cloudflare pricing/quotas and WebSocket/hibernation semantics before production.

## 17. Decisions still requiring confirmation

These are narrow implementation choices, not reasons to reopen the MVP feature set:

1. Initial full-board catalog size, wall/target coordinates, and robot-start positions.
2. Solver algorithm, time budget, and fallback for a round with no promptly verifiable unused target.
3. Whether the tie timestamp remains the **first accepted bid** after subsequent bid reductions.
4. Exact disconnect grace period, room expiry, and conditions under which host may skip an active attempt.
5. Maximum bid value, nickname constraints, and room-code length.
6. How to handle a player who leaves permanently mid-match.
7. Whether a rematch requires host confirmation or a ready check.

## 18. Architectural principles for Codex

- Treat `docs/product.md` as authoritative for rules; flag contradictions rather than guessing.
- Keep geometry/movement functions pure and framework-independent.
- Server decides official game state; client is a view and command sender.
- Prefer small vertical slices and automated tests over broad rewrites.
- Never change carry-forward robot positions, 60-second bidding, or no-timer demonstrations without explicit product approval.
- Avoid adding accounts, chat, matchmaking, or other out-of-scope systems.
