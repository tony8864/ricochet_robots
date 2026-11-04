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

T14 planning decisions approved in discussion on 2026-10-27: use a fixed 24-hour
browser-session lifetime from issuance (refresh/activity do not extend it), one
shared registry for session/code/creation coordination, and one Durable Object per
room for roster/board/revisions/room-local replay state. Persist private verifier
records rather than raw credentials, using built-in Durable Object storage without
an external database. Cross-object creation is not one transaction; T14.1 must
review durable reservation/initialization/recovery and resource protections.
Local PC/Android testing is planned behind same-origin HTTPS; certificate/device
trust installation needs separate permission. These are plans, not implemented
server behavior. The current scope is T14.1–T14.5 live lobby data via development
tools; product UI, live Start locking and full T14 verification remain later.

The owner subsequently approved the detailed T14.1 design. Its local scaffolding
now exists in `apps/server`: Worker routing, SQLite Registry/Room bindings and
versioned schema metadata only, generated runtime types, Workers smoke tests and
a full local-runtime restart/persistence test. Session/room/socket handlers remain
unimplemented and fail closed. Vite proxies same-origin `/api` HTTP/upgrades to a
loopback Worker, with an opt-in certificate-path HTTPS mode. No trust installation
or deployment has occurred. See `docs/local-development.md` for the pinned
Node-20/Vitest-3-compatible toolchain and pending HTTPS/device verification.

T14.2 adds only anonymous browser identity: `POST /api/session` validates the exact
HTTPS Origin, content type and bounded streamed body before T13 parsing. Registry
persists SHA-256 verifiers of 256-bit random cookie credentials, private session
UUIDs and fixed 24-hour issue/expiry/revocation records. A private verification
method checks server time/revocation; valid reuse does not reset Set-Cookie or
expiry. Issuance rate/capacity updates are object-local atomic writes. No seats,
room handlers, public revocation endpoint or client identity fields are added.
Header/runtime tests and cold-runtime expiry checks pass independently of actual
browser/Android cookie testing, which still awaits approved HTTPS setup.

T14.3 adds authenticated `POST /api/rooms`. Registry atomically reserves canonical
codes, IDs, normalized request/replay context and immutable initialization data;
Room separately commits one host membership and projected lobby. Registry publishes
the code only after Room confirms initialization. Duplicate retries recover the
same room; conflicting payloads fail. Pending work survives restart and is retried
in bounded alarm batches, without cross-object transactions or record eviction.
Room's private session-to-seat mapping never enters public snapshots. Shared
bootstrap HTTP checks serve both session and creation routes. Current state is
read on replay, and RPC lifecycle metadata is disposed/kept out of JSON validation.
Live joins, sockets, host shuffle/start and game integration remain later tasks.

T14.4 adds authenticated code-based join and route/body-bound explicit resume.
Registry verifies identity before resolving a published destination; Room commits
membership, revision and scoped replay outcome in one SQLite transaction. Existing
members retain their seat/nickname regardless of capacity/lock; new seats require
an unlocked lobby below six players. Resume cannot allocate a seat. Current public
snapshots accompany original replay outcomes; credentials and private mappings are
never returned. Create/join/resume share Registry bootstrap rate accounting, while
Room retains bounded, non-evicting replay records. Restart tests cover joined seats
and join/resume outcomes. No live sockets, automatic reconnect or host transfer is
implemented by these endpoints, and HTTPS/device checks remain pending.

T14.5 adds a hibernation-compatible Room WebSocket transport for the live lobby.
Worker strips incoming authority headers and forwards only server-authenticated
identity through a private binding request; Room checks membership/Registry again.
Private socket attachments survive wake without storing raw credentials. Serialized
Room events update durable connection flags/revisions and broadcast validated full
public snapshots. State reads and host-only context-bound shuffle share membership's
room-scoped replay ledger/caps. Session checks apply to commands and delivery, with
an earliest-expiry Room alarm; T15 must coordinate its bidding alarm with this one.
Cold restart/rebind tests preserve selected board, seats and shuffle outcomes while
repairing lost-transport flags. No connected UI, network match or automatic mobile
reconnect is implied. Real HTTPS browser/device checks remain pending.

T14.6 subsequently adds real Create/Join entry through a small cookie-managed HTTP
adapter in `apps/web/src/entry`, with validated binding, explicit errors and exact
in-memory request retries. T14.7 routes success into a connected lobby using shared
`LobbyPreview` presentation, separate from the development controller. The adapter
in `apps/web/src/lobby` validates private WSS binding/public snapshots, applies
monotonic revisions and correlates shuffle results without optimistic board edits.
Disconnected actions are disabled; explicit reconnect rebinds the existing cookie
and seat. No new session is silently issued. The room code/Copy appear above the
board on the right. Page-reload recovery, automatic mobile reconnection and full
match transport remain unimplemented, not inferred from the local UI.

T14.8 connects authenticated `room.start` to pure `createMatch`. The current
host/current lobby/selected board/2–6 seated players are checked server-side;
initial Preparing, its public projection, revision and replay outcome commit in
one existing Room SQLite transaction. The room JSON adds an optional private
`match: { version: 1, state }` record; old lobbies remain readable without a
migration/reset. Version 1 validates initial Preparing only against its exact
private shape and public projection, without rerunning creation or a solver on
restore. Corrupt/unsupported data fail closed; T15 must extend the codec for
later phases. Private match state is never broadcast. Serialized membership and
Start ensure the accepted roster/board are locked; new joins fail, existing seats
resume. Client Start/Shuffle share one pending mutation with exact retry, including
Start-result recovery after a Preparing snapshot/rebind. The Preparing UI retains
read-only board/roster/code/connection feedback; no target selection or timer is
scheduled here, so remaining in initial Preparing is expected until T15.

T15.2 extends private match persistence to version 2 for Preparing jobs and
Thinking. Existing version-1 initial Preparing records are validated, then gain
one job on wake without recreating a match; old lobbies remain unchanged. The job
stores its ID, server-shuffled candidate order, full immutable request snapshot,
fixed bounded policy and due/retry times. Start commits job intent with its match,
public revision and replay outcome; a subsequent Room alarm runs the selector.
Alarm scheduling uses the earliest preparation/recovery or session-expiry
obligation and repairs missing alarms on wake/publish. It is not parallel search.

The job is durably marked running and a 30-second recovery obligation installed
before search. Each logical job invokes the bounded selector at most once. A
crash after claiming or an uncertain result commit becomes an explicit error at
recovery, not another automatic search; the recovery time is not a search timer
or demonstration grace period. Successful acceptance rechecks current job/context
and proof, then atomically stores Thinking/target consumption/revision before
broadcast. Proofs are not persisted in ordinary match state or broadcast.

Deferred/unavailable results retain copied private diagnostics; sanitized errors
retain no exception detail. All preserve official game state. The current host
may issue `preparation.retry` with match/preparation IDs only for deferred/error,
after a five-second server cooldown. Exact retry/replay and conflicting-ID rules
are unchanged. Public failed preparation may advertise safe retry ID/time metadata;
working/unavailable cannot. No reset, target reuse, board replacement, automatic
budget escalation or unavailable-state escape is authorized. T15.3 still owns
connected UI, T15.4 bids/deadlines and T16 attempts/results/Continue.

T15.3 connects the existing web adapter to public Preparing/Thinking snapshots.
Start, Shuffle and preparation Retry share one immutable pending request slot;
lost replies can be retried exactly after reconnect or later phase snapshots.
Preparation cooldown UI uses server retry/send-time metadata and a cleaned-up
one-shot timer, not the browser wall clock; the server still authorizes every
request. Snapshot revisions alone drive target/phase/official positions. Shared
presentation shows the read-only board, target/round, existing disabled bid card
and player-bids roster while preserving code/connection feedback. No local match
controller, preparation search, bid acceptance or countdown is run by this view.

T15.4 adds authenticated `bid.submit` through that same serialized/replay-safe
Room path and the pure T11 reducer. Private match version 3 stores Bidding with
one absolute 60-second deadline, or the initial Demonstrating state with its
persisted attempt identity/version. Old v1/v2 records remain compatible; v3 does
not accept movement history or later result phases yet. Expiry freezes bids by
value/original acceptance order and creates one empty attempt without changing
official positions or scores. Duplicate reads/alarms/retries cannot recreate it.

Bidding shares earliest-due scheduling with preparation/recovery and session
expiry, even without sockets. Due time is normalized on commands (including
replays/rejections), public delivery, membership/creation reads, rebind and cold
wake, rather than relying on timely alarm delivery alone. Accepted bids and
public revisions/replay outcomes commit together. Private reply normalization
also marks a broadcast owed, so other clients are not left on an overdue phase.

The connected bid card keeps drafts local and sends immutable requests; only
accepted snapshots drive bids/roster order. The header countdown estimates server
time from send-time metadata plus monotonic elapsed time, not `Date.now()`. It is
informational and subject to network/suspension error. Local zero disables new
bids but never advances a phase. Explicit rebind resynchronizes; T17 retains
automatic recovery. Initial Demonstrating displays bidder/bid/moves/target but
has no T16 movement/scoring controls. No protocol extension or game-rule change
was needed for bidding/deadlines.

T16.1 connects the four existing attempt commands through authenticated Room
serialization and the pure reducer. Private match version 4 supports live retained
history, later bidders and Round Result, preserving valid v1–v3 records. Restore
replays retained history from round start without a solver and checks endpoints,
current positions/count, metadata and exact public/private agreement. Each replay
step uses temporary one-move history to avoid quadratic prefix copying. No history
or proof is broadcast. Continuing attempts keep their UUID and increment a monotonic
version only for accepted changes; no-ops preserve it, and new bidders get a fresh
UUID/version zero. Undo/Reset never rewind the version to move count.

Movement, corrections, immediate Give Up, success scoring/all-four carry-forward,
or exhausted-queue result commit with revision and original replay outcome in one
SQLite transaction before delivery. Exact retries are resolved before stale attempt
checks, after identity/membership validation. Existing raw-size/rate/replay caps
and session alarms remain; no demonstration timer or new history/bid limit exists.
Storage and validation still grow with retained history; hosted worst-case costs
remain unbenchmarked. Continue/results UI/rematch and T17 policy remain later.

T16.2 connects the existing demonstration controls to the same single pending
room request slot. Only the bound active seat can submit; selection stays local,
while positions/count/turn remain snapshot-owned. Acknowledgment plus authoritative
revision reconciles the pending action; dropped taps are not queued. Uncertain
requests retain their original ID/payload for explicit retry across rebind or
later phases. No local reducer or optimistic movement/scoring runs here.

The owner approved ordinary transform animation for Reset as well: all robots
move directly back together, not through discarded move history. No wire metadata
is added. A client presentation epoch remounts the SVG on rebind, attempt identity
change or missed attempt versions to snap instead of playing missed movement.
Reduced-motion behavior and board geometry remain unchanged. Read-only interim
round results preserve the board/connection/retry UI until T16.3; no Continue or
automatic progression is implemented. The owner subsequently confirmed the
twelve-item PC/phone checklist; exact device/browser versions and iPhone Safari
verification were not supplied. This is owner-reported, not agent-operated evidence.

T16.3 adds authenticated host-only round Skip/Continue to the existing serialized
replay path. Skip is confirmed and Thinking-only; bid/Skip races cannot both win.
Continue maps to the pure controller advancement only after server authorization.
Rounds 1–9 save Preparing plus a queued job/revision/replay atomically, with no
synchronous search; round 10 saves strict version-5 Finished with no round-11 job.
Older private versions remain readable. Advancement never scores or resets robots.

Connected results reuse the native modal with public-only presentation fields
and controlled pending state. The host advances; guests wait. Snapshot transitions
dismiss the modal; subsequent preparation errors use Preparing feedback. Reconnect,
safe errors and exact retry controls appear inside the modal when needed so
background inertness cannot block recovery. Thinking-only host Skip rechecks its
captured state after confirmation. Final standings/rematch remain T16.4; Finished
currently has an honest placeholder. Automated WSS/restart/adapter/markup checks
pass; the owner subsequently accepted the basic Skip/Continue-through-round-10
flow. Individual recovery/visual/device cases were not separately confirmed.

T16.4 reuses the established fullscreen results and pure standings calculation
with only public presentation fields. New Match uses authenticated, host-only,
Finished-match-bound `match.returnToLobby`. Lobby projection, fresh lobby UUID,
revision and replay outcome commit together; active match state is removed while
room/code/host/roster/connections, private identity mappings and replay history
remain intact. No credentials are refreshed. Finished stays locked to new seats;
normal lobby joins resume after return.

Preview policy matches the local flow: retain the completed board for explicit
host Shuffle/Start. Return does not start a match or search. A subsequent normal
Start creates a new match with catalog initial positions and clean scores/history.
Pending/error/explicit retry handling reuses the single immutable room-action slot,
including recovery after the lobby snapshot has already arrived. Older exact
requests replay outcomes without reverting current state; stale new requests fail.
Local simulator ownership and scoring rules are unchanged. The owner accepted
T16.4 and explicitly confirmed all three result variants display correctly.
Individual recovery/device cases were not separately confirmed. T16.5 targeted
automated reliability verification is complete: competing authenticated tabs,
two-/six-seat permissions, replay retention through corrections/transitions,
transaction failure rollback, post-Undo/scored-result restart and persisted replay,
expiry and client conflict/rebind coverage. No production change was required;
see its task evidence and resource limits. T16.6 adds authenticated HTTP/WSS
ten-round lifecycle verification for a two-player winner, six-player tie and
two-player no-winner match, followed by same-room lobby return and explicit fresh
Start. The driver controls clock/selection entropy, not production budgets or
game state; privately replayed proofs are never exposed. Mid-match controller
reconstruction/rebind complements T16.5's independent full-runtime restart tests;
it is not a process restart inside the full-match script. Rendered-browser/device
checks were subsequently reported working by the owner across the eight-item
manual checklist (2026-11-01); exact device/browser versions were not recorded,
so no specific iPhone Safari verification is claimed. These fixtures do not certify arbitrary carry-forward
solvability, hosted resources or automatic mobile recovery.

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
- Preserve the original host; the owner explicitly rejected host transfer for this private-friends version. Host-only actions wait if the host is absent.
- Expire rooms after 30 continuous empty minutes, separate from the fixed 24-hour identity lifetime; review durable cleanup/tombstone retention before implementation.

## 12. Reconnection and browser lifecycle

T17.3 adds bounded automatic recovery to the web adapter: one active generation,
cancellable cookie-authenticated resume, watchdog/backoff, offline/online/visibility/
BFCache handling and manual fallback. Validated per-tab routing plus one immutable
pending request survive refresh in sessionStorage; cookie, private history and
proofs do not. Entry resumes before private WSS binding, honors different invites
and routes terminal feedback without silently issuing an identity. Binding/current
snapshots remain authority; uncertain gameplay needs exact explicit Retry, never
an offline queue or fresh-ID replay. Storage denial is reported. Grace/abandonment,
End and actual empty expiry remain later steps. Full-runtime HTTP/WSS tests
exercise the real frontend adapter, not a rendered browser or physical device.
All 1,430 workspace tests, type checks and production build passed at T17.3.
The owner subsequently confirmed seven PC/phone smoke checks: lobby refresh,
Wi-Fi recovery/presence, lock/resume, bidding refresh, demonstration refresh/Undo,
result refresh/Continue and Finished refresh/rematch. Exact device/browser versions
were not recorded; T17.8 retains broader combined verification. Bootstrap creation before room entry is not
persisted by this live-room recovery checkpoint. Planning notes below describe
decision history, not additional implemented lifecycle behavior.

T17.2 implements server liveness using private SQLite connection leases plus
versioned attachment IDs. V2 private binding/ping/pong contracts and a minimal
ten-second browser keepalive accompany 30-second server leases. Timely valid
incoming traffic renews; outgoing snapshots/duplicate heartbeats do not. Multiple
tabs aggregate to one seat; offline/empty timestamps preserve effective expiry
times and public presence changes commit atomically. Lease/session alarms share
existing preparation/bidding obligations. V1 canonical receipts remain immutable
and lookup-only historical retries never execute an original action. Full runtime
restart tests cover overdue lease normalization; automatic client recovery, bidder
grace/skip, closure and empty-room expiry remain later T17 steps. No host transfer
or game-rule change is introduced. T17.2 verification passed all 1,383 workspace
tests, type checks and production build. See its task for warnings/resource limits;
no new phone/browser or hosted-performance evidence is claimed.

T17 planning decisions approved on 2026-11-01 supersede earlier host-transfer
proposals: no host reassignment; approximately 30-second unresponsive-connection
detection; 60-second disconnected-active-bidder grace followed by confirmed
host-only Skip Attempt, never automatic forfeiture; and 30-minute empty-room
expiry. Accepted bids and server deadlines continue through disconnects. Preserve
all-four rollback, uncertain command identities and authenticated same-seat resume.
Guests get confirmed Leave Room; the host instead gets confirmed End Room, a
terminal closure rather than a fabricated result or rematch. Guest seat-retention/
multi-tab semantics, lifecycle wire/storage design and cleanup retention remain
explicit T17.1 review gates. These are plans, not implemented behavior. See
`docs/tasks/T17-reconnection-and-room-lifecycle.md` and its ordered subtasks.

T17.1's written design now proposes tab-local seat-preserving Leave, a versioned
heartbeat/lease protocol, bounded automatic recovery with safe per-tab resume data,
lookup-only historical command retries, durable grace/terminal state and a
Registry invalidation outbox. Private cleanup after member identity expiry plus
minimal non-reusable-code tombstones under existing capacity limits is proposed,
approved by the owner on 2026-11-01, including the protocol-version transition,
but not implemented. The accepted design is in
`docs/tasks/T17-1-lifecycle-design-and-contracts.md`; T17.2 requires a separate request.

T17.5 implements guest-only, confirmed, tab-local departure in every phase.
It stops that adapter's transport/recovery without a membership command or cookie
change. Validated sessionStorage retains an uncertain request with `autoResume:
false`; refresh stays at entry, while explicit same-seat join restores exact Retry
and normal recovery. A failed storage write refuses departure with inline feedback.
Other tabs, seats, bids and scores remain unchanged. Shared dropdown/native modal
presentation includes accessible result-screen actions; the board renderer and
game rules are untouched. Web tests (393), four full-runtime client recovery tests,
workspace type checks and production build passed. Browser access was unavailable;
the owner subsequently confirmed core departure/rejoin and retained bid/attempt/
result behavior. Exact devices and a multi-tab manual pass were not recorded.
Leave preserves the active attempt via ordinary presence, never implicit Give Up.

T17.4 adds versioned private Room attempt-presence metadata, outside the pure
match/history model, persisted atomically with public state and replay outcomes.
Effective absence is clamped to attempt activation; queued offline bidders get
fresh grace when selected. Public Demonstrating snapshots allowlist nullable
disconnect metadata and one eligibility revision. Retained pre-T17.4 snapshots
without the optional field are migrated on wake, without resetting established
deadlines or tokens. Grace joins the shared alarm scheduler; a connected tab
cancels it, and no automatic forfeiture exists. The host's validated confirmed
`attempt.skipDisconnected` binds match/round/attempt/version/absence and is
authorized against current presence and server time. It invokes a trusted pure
controller failure transition sharing Give Up's rollback, not a forged bidder
action. Exact retries precede stale checks and cannot advance twice. The existing
demonstration panel temporarily presents disconnect/countdown/host-only skip;
the SVG, compact header and ordinary white bidding timer are unchanged. Automated
boundary/race/transaction/restart/client tests pass; its rendered/phone review
was subsequently accepted through the owner's core grace/cancel/skip/rollback/
rejoin/Undo/no-bidders checks; exact device versions and multi-tab manual evidence
were not recorded. T17.6 now implements End Room; 30-minute empty expiry is later.

T17.6 adds local-first terminal storage, not a new game phase. `room.end` binds the
current lobby/match, requires confirmed authenticated original-host authority,
and commits revision, terminal record/outbox and receipt atomically. All Room
admission, initialization, command, preparation and publication paths honor the
tombstone; closure neither awards points nor fabricates Finished. Server closure
notifications stop transport/recovery and remount entry, including the previously
entered form. The host's all-phase compact menu and existing-style red native
confirmation are presentation only; guests retain tab-local Leave.

Registry invalidation is a separate idempotent outbox RPC, retried in five seconds
on failure. The Room refuses admission even before directory repair. Minimal
directory tombstones override pending/published creations and survive redaction;
reserved codes/IDs cannot be reused. After the conservative approved 24-hour
maximum identity-retention window and acknowledged directory redaction, private
room state/history/replays and initialization payloads are purged. Pending outbox
work postpones redaction. Tombstones still count toward the existing 1,000 creation
cap; no session revocation, host transfer or open-room empty expiry is added.

Exact receipts remain privately readable through same-origin authenticated
`POST /api/rooms/:roomId/retry`, even when WSS binding is denied for a closed room.
It accepts the same original bounded room envelope but is strictly lookup-only,
with current cookie/membership validation and existing bootstrap budgets. It
cannot run a missing request or return an obsolete public snapshot. Closed Join/
Resume returns `room-closed`; `room.closed` includes `host-ended`. Current v2
backend and frontend tabs must be upgraded/reloaded together. Real-adapter,
atomicity, retention/outbox and full-restart checks pass; rendered T17.6 review
was subsequently accepted by the owner through the core guided checks; exact
device/browser versions were not recorded.

T17.7 implements empty-room expiry using private presence schema v2. A persisted
`empty_expires_at` accompanies `empty_since`; the final authorized responsive
connection disappearing starts 30 continuous minutes. Effective lease/session
deadlines are used on delayed detection. Authenticated binding strictly before
expiry atomically cancels the period; HTTP lookups, stale heartbeats and outbound
traffic do not. Connected rooms can remain idle indefinitely within their identity
lifetime. Reliable legacy empty timestamps are preserved; unknown timing starts
at first reconciliation. Existing periods retain their persisted deadline.

The shared alarm, constructor wake and admission/mutation/preparation gates apply
deadline-first expiry. The terminal revision/outbox uses reason `expired`, with
distinct `room-expired` entry rejection; existing directory invalidation and
24-hour private-data retention/cleanup are reused. No score/position transition,
host transfer, identity renewal or new public deadline is introduced. Local-only
`LOCAL_EMPTY_ROOM_TIMEOUT_SECONDS` allows 1–1800 seconds for manual testing;
non-local environments always use the production 30 minutes. Automated boundary,
migration, race and full-runtime recreation coverage is separate from pending
physical-device expiry review. The owner subsequently confirmed the expiry case
with a 10-second local override; exact devices and the connected-room/early-return
variants were not separately recorded.

T17.8 verifies the assembled lifecycle rather than adding server behavior. Its
new six-cookie real-client scenario combines host absence, accepted bid lowering
with original tie priority, bidder reconnect/grace cancellation, later authorized
skip, identical snapshots for all six seats, and terminal closure/code rejection.
Existing two-seat tests cover uncertain-command recovery and tab-local departure;
full ten-round HTTP/WSS games and independent SQLite runtime disposal/recreation
tests remain separate evidence. These adapters are not rendered-browser/mobile
suspension tests. The owner subsequently confirmed guided PC-host/phone-guest
multi-tab presence, host absence/return, round-result refresh, lock/resume, Wi-Fi
recovery and final-results refresh on both devices. Exact browser versions and
broader device/role variants remain unverified. The checklist and limits are tracked in
`docs/tasks/T17-8-recovery-and-lifecycle-verification.md`; no iPhone Safari,
deployment, hosted-resource or general solvability certification is implied.

Mobile Safari may suspend background tabs and drop WebSockets. Design for this as normal behavior.

- On resume, reconnect with the seat credential and room ID.
- Server returns a complete, current snapshot including phase, deadline, positions, active bidder, and scores.
- Reconstruct UI from that snapshot; do not replay all past animation frames.
- Countdown displays time remaining using the server deadline plus an estimated clock offset; server remains authoritative.
- Preserve official state when all clients temporarily disconnect; define room expiry separately.
- Provide a visible reconnecting state and disable state-changing controls until synchronized.

## 13. PWA UX and offline behavior

T19.1 adds the root-scoped standalone manifest and original standard/maskable/
Apple icons. The owner confirmed Android home-screen installation and gameplay;
physical iPhone verification remains outstanding. T19.2 implements production-only
registration and a Vite-generated static service worker without a new dependency.
Its content-addressed, exact SHA-256 allowlist contains only the public shell,
emitted application assets and reviewed manifest/icons. Downloads omit cookies;
status, MIME, privacy headers and bytes are checked before a complete cache installs.
API/non-GET/cross-origin traffic bypasses caching and there are no runtime writes,
offline gameplay submissions or credentials/state in this cache.

Navigation prefers network HTML only when it matches the active build, otherwise
uses that version's cached shell on eligible root/invite routes. This keeps HTML
and chunks coherent while a new build waits. Default lifecycle activation waits
for old controlled clients to close: no skipWaiting, clients.claim or automatic
reload. Cleanup touches only this app's static-cache namespace. Existing T17
cookie identity, route/pending-command storage and fresh authoritative recovery
remain unchanged. Browser storage eviction/denial may remove offline availability;
online-only multiplayer and protocol validation still apply. See
`docs/pwa-testing.md` for build/update checks and deployment/device limits.

T19.3 reuses `browserRecoveryEnvironment` in presentation via a React external-store
subscription, not a second recovery state machine. Known-offline entry/Retry/
Reconnect controls and submit handlers are gated without discarding drafts or
uncertain request identity. Positive online hints never set transport connected
or submit a request. Existing server binding/recovery still owns synchronization.
Edge-to-edge viewport metadata, max(padding, safe-area inset) for the board page,
and dynamic body/root viewport minimums preserve existing layout breakpoints and
touch controls. Native keyboard/notch and physical Safari checks remain separate.

- The app shell and static assets may be cached for quick launch.
- **Live multiplayer is online-only.** If offline, show an understandable connection message; do not permit offline bids or moves that would later be merged.
- Board is read-only during thinking/bidding.
- During demonstration, show selected robot, directional controls, move count, undo, reset, and give up.
- Keep the 16×16 SVG square and legible in portrait; avoid accidental page scrolling while interacting with controls.
- Use color plus shape/symbol to identify robots and targets.
- Invite links must work directly in iPhone Safari, with manual room code as fallback.

## 14. Testing strategy

T18.1 adds a separate `apps/e2e` workspace using pinned Playwright 1.64.1. Its
worker-scoped fixture builds the existing production frontend into a verified
temporary directory and bundles the actual Worker entry with esbuild. Miniflare
serves assets/API on a loopback ephemeral HTTPS origin, with exact Origin bindings
and isolated durable storage. It uses no development proxy, `.dev.vars`, existing
server or production debug route. Test-only certificate exceptions are confined
to the disposable browser process; neither system trust nor server security is
changed. Two independent context smoke tests cover entry, secure-cookie isolation
and a real WSS rejection. Successful authenticated room flow remains T18.2; clock
control, full-match/browser recovery and device coverage remain later checkpoints.
Normal workspace tests do not launch browsers; see `docs/browser-testing.md`.
T18.2 adds three UI-driven entry/lobby cases: validation and inline errors,
Create/Join/invite/clipboard, shared roster/board, host-only Shuffle/Start and
locked-match new-identity rejection with same-seat refresh. Public snapshot
observation supplements DOM comparisons without retaining private binding data.
No production code, clock hooks, game rules or new runtime dependencies changed.
T18.3 adds one rendered round through the actual 60-second bidding deadline,
corrections/no-op counting, two-robot failure rollback, second-bidder success and
all-four carry-forward into verified round-two Thinking. A bounded private Node
driver computes/replays a route from actual public board/target state; only normal
UI actions reach the game. No test-clock/entropy hook, accepted-state injection,
proof API or production rule change was introduced.
T18.4 keeps production timing too: two real bidding windows in a mixed ten-round
browser game (one success after an earlier failure, one exhausted-bidder round,
eight normal host skips). It verifies per-round agreement, ten distinct reveals,
Finished/refresh, same-room lobby return and fresh Start; it is not ten successful
demonstrations or a process-restart/device test. A separate six-context browser
case checks distinct identities, shared roster/board and live bid ordering. No
test-only backend control or application change was added.
T18.5 adds three browser recovery cases and Finished offline checks. Only the
recovery file opts into a separate test Worker bundle with a private Node-controlled
server-clock Durable Object and real Room alarm normalization. The production
input-graph exclusion guard remains, normal Worker routing exposes no clock API,
and normal-time tests retain their actual deadlines. A real-server WebSocket
proxy drops one acknowledged move reply; refresh/exact retry must return the
stored duplicate without applying another move. Authenticated reads preserve
responsive leases across clock steps; no stored presence/game state is faked.
Native offline/tabs, retained attempt/history, grace/cancel/skip, result recovery,
End and distinct empty expiry are exercised without production changes. Browser
recovery is not a claim of real process restart or physical Safari suspension.

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
- Room lock, reconnect, fixed host authority, abandoned-attempt grace/skip, guest departure, host closure and expired room.
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
4. Implementation of approved disconnect grace/skip and empty-room expiry; lifecycle contracts/retention still require T17.1 review. No host transfer.
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
