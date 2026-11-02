# Development Plan — Multiplayer Sliding-Robot Puzzle

**Status:** Proposed execution roadmap, v0.1  
**Audience:** Project owner and Codex  
**Companion documents:** `docs/product.md`, `docs/architecture.md`, root `AGENTS.md`

## How to use this plan

This is a **roadmap and checklist, not an instruction to implement everything**. The owner selects one task ID at a time and asks Codex to implement only that task. Codex reads the companion documents, proposes a small approach, makes changes, runs checks, and reports results. The owner reviews the outcome before checking the task off and starting another.

**Task completion rule:** Mark a task complete only after its acceptance criteria are verified. Use `[ ]` pending and `[x]` complete. Keep unresolved decisions visible; do not silently invent gameplay rules.

**Source-of-truth order:** `docs/product.md` defines gameplay; `docs/architecture.md` defines technical direction; `AGENTS.md` defines Codex working practices. Raise contradictions before coding.

### Clarification to synchronize across the documents before implementing bids

- Each player can bid **any positive integer**, regardless of what other players bid; higher bids are allowed.
- A player can **lower their own existing bid**, but cannot raise it.
- All bids must arrive before the 60-second window closes. Once it closes, there are no new bids, even after failed demonstrations.
- Demonstrations run from lowest final bid to highest; equal bids are ordered by earlier **first accepted bid** (proposed tie convention; confirm before implementation).

Update `docs/product.md` and `docs/architecture.md` to state this explicitly, keeping `AGENTS.md` consistent.

## Milestone 0 — Repository foundation

**Outcome:** A small, working TypeScript workspace with predictable scripts and documentation.

- [x] **T00 — Align and import project documents**
  - **Scope:** Add the three agreed files at their intended paths and this plan. Synchronize the bidding clarification above. Do not change gameplay rules beyond that clarification.
  - **Acceptance:** `AGENTS.md`, `docs/product.md`, `docs/architecture.md`, `docs/plan.md` are present, readable, and internally consistent.
- [x] **T01 — Initialize minimal workspace**
  - **Scope:** Set up pnpm workspaces for `apps/web`, `apps/server`, `packages/game-engine`, `packages/shared`, and `packages/puzzles`; configure TypeScript and Vitest. Scaffold only what is needed to run checks.
  - **Acceptance:** Fresh install succeeds; root scripts for type checking and testing run; packages resolve locally; no unused framework or deployment configuration.

**Review gate:** Owner can clone/install the repository and run the documented checks.

## Milestone 1 — Pure game engine

**Outcome:** Correct robot movement with no UI or network dependency.

- [x] **T02 — Board and state data model**
  - **Scope:** Define 16×16 coordinates, blocked cells, symmetric blocked edges, robot IDs and positions, target types, immutable state, and validation helpers.
  - **Acceptance:** Unit tests reject invalid positions, overlapping robots, malformed edges, and blocked-center occupancy; coordinate conventions are documented.
- [x] **T03 — Sliding movement**
  - **Scope:** Implement pure movement for one robot and one cardinal direction; stop before walls, board boundary, blocked cells, and other robots.
  - **Acceptance:** Deterministic tests cover each direction, collisions, chained obstacles, boundary stops, and no-op moves; input state remains unchanged.
- [x] **T04 — Target completion and move history**
  - **Scope:** Implement matching-color and wildcard target checks; a reusable pure attempt model supporting moves, undo, reset, and current move count.
  - **Acceptance:** Tests verify no-ops do not count, undo/reset restore correct positions, and success is recognized only for the required target condition.

**Review gate:** Engine tests pass with no React, browser, Cloudflare, or networking imports.

## Milestone 2 — Local playable board

**Outcome:** A usable phone-sized board that demonstrates movement without multiplayer.

- [x] **T05 — React/Vite app shell and SVG board**
  - **Scope:** Create a mobile-first portrait page and render a 16×16 SVG grid, walls, blocked center, four distinct robots, and a target from a deterministic fixture.
  - **Acceptance:** Board is square and readable on narrow phone viewports; walls align with the engine's blocked edges; no horizontal overflow.
- [x] **T06 — Local demonstration controls**
  - **Scope:** Add robot selection, four directional buttons, current move count, undo, reset, and target feedback, all backed by the shared engine.
  - **Acceptance:** A user can complete a fixture puzzle with touch controls; blocked moves do not increment count; undo/reset work; basic accessibility labels are present.
- [x] **T07 — Mobile usability pass**
  - **Scope:** Test on an actual iPhone Safari and an Android browser when devices are available; adjust layout, touch targets, and visual distinctions.
  - **Acceptance:** No accidental scrolling during board interaction, controls are reachable in portrait, and colors are not the sole identifying cue. Document any device-testing gaps.

**Review gate:** Owner can play a small local demonstration puzzle on a phone.

## Milestone 3 — Designed full boards, solver, and local match

**Outcome:** Ten-round rules work locally before adding networking.

- [x] **T08a — Target symbols, model, and rendering**
  - **Scope:** Add validated symbol metadata and reusable SVG artwork for star, crescent, triangle, square, and vortex. Display all 17 targets (four symbols per robot color plus one wildcard); mute inactive targets and outline the active target's cell in white. Keep engine completion based on robot requirement and position.
  - **Acceptance:** Tests cover valid/invalid symbol combinations, unchanged completion rules, all-target rendering and active highlighting, and the existing demo solution. Workspace checks pass and the owner reviews the artwork on a phone. See `docs/tasks/T08a-target-symbols-and-rendering.md`.
- [x] **T08b — Original full-board catalog and validation**
  - **Scope:** After T08a, create five original, individually designed 16×16 boards in `packages/puzzles`, one file per board, with stable IDs, complete wall and target coordinates, the blocked central 2×2, and valid initial robot positions. Each target sits inside a perpendicular wall angle; interior wall segments pair to form angles, with the agreed outer-border endpoint exception. Use the catalog directly in the playable demonstration, selecting the board through one `DEMO_BOARD_ID` setting. The owner requested the remaining four layouts after testing the starter and reviewing the authoring format.
  - **Acceptance:** Catalog tests verify board/target IDs, all 17 agreed targets, valid coordinates, center blockage, distinct legal robot starts, each target's wall angle, and the wall-pair rule. The demonstration uses the selected catalog geometry, targets, and starting positions. A separate starter-board regression checks its known blue-star solution and undo/reset. Whole-catalog solvability remains T09–T10; host lobby preview/shuffle UI remains T12/T14. See `docs/tasks/T08b-full-board-catalog-and-validation.md`.
- [x] **T09 — Solvability validator spike and benchmark**
  - **Scope:** Prototype a hidden solver that verifies at least one solution for a target from *current* robot positions. Measure performance on representative states; identify a bounded fallback policy.
  - **Acceptance:** Demonstrated solvable/unsolvable fixtures; measured time and search limits recorded; no unverified target is declared solvable. **Do not proceed to live round generation until the fallback is approved.**
  - **Evidence:** `docs/tasks/T09-solvability-validator-and-benchmark.md` and `docs/benchmarks/T09-solvability.md`. Bounded solver, replay/parity tests, and five-board initial/carry-forward benchmarks complete. The T10 implementation request approved the pure selector policy; live recovery/runtime review remains before multiplayer integration.
- [x] **T10 — Target selection and round setup**
  - **Scope:** Select unused, verified-solvable targets from official robot positions; define behavior if validation times out or candidates are exhausted according to the approved fallback.
  - **Acceptance:** Tests prove no target repeats, selected targets are verified from carry-forward positions, and the system does not hang or reveal an unverified target.
  - **Evidence:** `docs/tasks/T10-target-selection-and-round-setup.md` and `docs/benchmarks/T10-round-setup.md`. Pure selector implemented with already-complete filtering, explicit per-candidate/aggregate caps, proof replay, and distinct deferred/unavailable outcomes. Live recovery scheduling remains a later integration decision.
- [x] **T11 — Pure match state machine**
  - **Scope:** Implement lobby-independent match phases, 10-round progression, scores, bidder order, demonstration attempts, success/failure transitions, and match results using injected time for tests.
  - **Acceptance:** Tests cover successful carry-forward of **all four** robot positions, failure rollback to round-start, no-bid skip, equal top scores, and 10-round completion; the selected board stays fixed throughout all 10 rounds.
  - **Evidence:** T11.1–T11.6 complete in `packages/match`: pure transitions, real T10 preparation, atomic resolution, and full two-/six-player ten-round scripts with per-action invariants and shared/all-zero winners. All 427 workspace tests, type checks, and production build pass. See `docs/tasks/T11-pure-match-state-machine.md` and `packages/match/README.md`. Live recovery, server runtime/authority, retries, durability, and reconnection remain later work.
- [x] **T12 — Local bidding and match UI**
  - **Scope:** Add a pre-match board preview and host shuffle control using the full-board catalog, plus thinking, 60-second bidding, demonstration, round result, and final score views using local state for development only. Shuffle chooses another complete catalog board; starting the match locks the layout.
  - **Acceptance:** A simulated group can play a complete 10-round match locally; no robot movement is possible during thinking/bidding; higher bids from other players remain allowed.
  - **Progress:** T12.1 implemented: one local T11 controller, Act as switcher, and adapted demonstration; 444 workspace tests, type checks, and build pass. Browser smoke verification was unavailable. T12.2–T12.6 remain pending; see `docs/tasks/T12-local-bidding-and-match-ui.md`.

**Review gate:** Complete local match with correct transitions; solver performance/fallback reviewed by owner.

## Milestone 4 — Authoritative multiplayer

**Outcome:** Two or more browsers can play a synchronized private room.

- [x] **T13 — Typed protocol and validation**
  - **Scope:** Define commands, snapshots, revisions, rejection reasons, and runtime message validation in `packages/shared`.
  - **Acceptance:** Invalid messages are rejected; types and schemas are tested; credentials are excluded from broadcast snapshots.
  - **Evidence:** T13.1–T13.5 complete on 2026-10-27: reviewed client/server contracts, public snapshot projection, strict runtime parsing, and two-/six-player ten-round contract composition tests. All 378 shared / 922 workspace tests, type checks, build, whitespace and dependency/source audits pass. Shared README contains the T14 handoff; real identity, networking, retries, persistence and reconnection remain later tasks. See `docs/tasks/T13-typed-protocol-and-validation.md`.
- [x] **T14 — Room creation, seats, and invite flow**
  - **Scope:** Create/join private rooms with short codes and URLs, nicknames, unguessable seat credentials, 2–6 player cap, host assignment, and lobby roster. Show the selected catalog board in the lobby and let only the host request a server-authoritative shuffle before starting.
  - **Acceptance:** Two browsers can join and see the same board preview; invalid credentials cannot impersonate a seat; only the host can shuffle while in the lobby; match start locks the selected board; a started room rejects new players but accepts returning seats.
  - **Progress through T14.7:** Implemented local Worker/Durable Object setup, fixed 24-hour cookie identity, durable registry-backed room creation, join/resume, authenticated lobby sockets, product Create/Join entry, and the shared connected lobby. Live snapshots drive the roster/board; only the host can shuffle. The room code is a top-right copy button with temporary checkmark feedback. The owner confirmed Create/Join between PC and Android and reviewed the lobby/code UI. Tasks are in `docs/tasks/T14-room-creation-seats-and-invite-flow.md`.
  - **T14.8:** Live host Start now atomically persists one initial Preparing match and replay outcome, locks the current board/roster, rejects new joins and preserves existing-seat resume. Shared client pending/retry handling prevents duplicate starts and overlapping Shuffle. Preparing deliberately has no solver/target scheduling until T15; owner device Start review remains pending.
  - **Verification:** T14.9 complete on 2026-10-30: owner-guided PC/Android create/join, live roster/shuffle, minimum-roster/guest controls, synchronized Start, late-join rejection, existing-seat rejoin, backend restart and code copying confirmed. All 1,152 tests, type checks, production build and whitespace checks pass. Wi-Fi-loss testing exposed stale online counts and return-to-entry on recovery; these are explicitly recorded T17 limitations, not a full recovery pass. See `docs/tasks/T14-9-final-verification.md`. A full networked match and host continuity remain later scope.
- [x] **T15 — Server-owned phases, bidding, and timers**
  - **Scope:** Add a Durable Object room state machine and persistent server deadlines; process bid commands atomically and reject late or unauthorized actions.
  - **Acceptance:** Tests cover first-bid 60-second deadline, higher bids by different players, lowering only one's own bid, equal-bid priority, and expiry races; clients cannot control timer authority.
  - **Checkpoints:** T15.1 local Workers preparation benchmark; T15.2 durable bounded preparation and safe host retry; T15.3 connected Thinking/preparation feedback; T15.4 authoritative bids/deadline and initial Demonstrating handoff; T15.5 integration verification. The owner approved the preparation strategy; benchmark evidence gates the runtime policy. See `docs/tasks/T15-server-owned-phases-bidding-and-timers.md` for progress.
  - **T15.1 measured:** 23 local Workers scenarios / 69 timed calls passed, including a full 200,000-expansion stress case. Round-trip median/p95/max 7.34/52.23/130.60 ms. Recommendation: retain provisional bounds for the next local checkpoint; peak memory and hosted resources remain unverified. See `docs/benchmarks/T15-local-workers-preparation.md`.
  - **T15.2:** Implemented durable bounded preparation, strict v2 Preparing/Thinking storage, legacy migration, earliest-due session/preparation alarm scheduling, at-most-one-search crash recovery and host-only cooldown/replay-safe retry contracts. All 1,184 tests, workspace type checks, production build and whitespace checks pass. Known Worker shutdown/cleanup warnings remain. Verified server targets enter Thinking; connected UI remains T15.3 and bidding T15.4. See `docs/tasks/T15-2-durable-bounded-target-preparation.md` for checks/limitations.
  - **T15.3:** Connected Preparing feedback/host Retry and authoritative read-only Thinking implemented; 243 web tests, type check and build passed. The owner subsequently reported it works and requested T15.4; no device-specific observations are independently claimed. See `docs/tasks/T15-3-connected-thinking-and-preparation-feedback.md`.
  - **T15.4:** Implemented authoritative independent bids/own reductions, durable 60-second deadline, earliest-due/no-socket expiry, v3 Bidding/initial-attempt persistence and connected bidding/countdown/roster/handoff. Its 1,238-test checkpoint was subsequently verified with owner device checks in T15.5. Movement/scoring remain T16. See `docs/tasks/T15-4-authoritative-bids-and-bidding-deadline.md`.
  - **T15.5 / T15 complete:** Audited integration/privacy/handoff coverage and added the session-expiry-before-bidding-deadline regression. All 1,239 tests, workspace type checks, production build and whitespace checks passed; known Worker shutdown/cleanup warnings remain. The owner confirmed all seven guided PC/phone checks, including tie priority, read-only UI and backend restart without deadline reset. Exact observations and remaining T16/T17/hosted-runtime limits are in `docs/tasks/T15-5-integration-verification-and-handoff.md`. No commit or deployment performed.
- [x] **T16 — Synchronized demonstration and scoring**
  - **Scope:** Validate moves, undo, reset, give-up, bid limits, and winning commits on the server; broadcast authoritative revisions.
  - **Acceptance:** Two browsers see the same robot positions and scores; only active bidder controls movement; failed attempts roll back; successful positions carry into next round; duplicate commands do not apply twice.
  - **Checkpoints:** T16.1–T16.6 complete. Automated ten-round HTTP/WSS verification passed (1,349 workspace tests, type checks and build); owner reported all eight manual checks working on 2026-11-01. Manual evidence is owner-reported, without exact device/browser versions or a specific iPhone Safari claim. Approved interaction: server-confirmed actions, one unresolved mutation/no tap queue, instant local robot selection, immediate Give Up with no confirmation. Normal moves and Reset animate directly; bidder changes/rebind/missed versions snap. No animation metadata extension. T17 recovery policies remain separate. See `docs/tasks/T16-synchronized-demonstration-and-scoring.md`.
- [ ] **T17 — Reconnection and room lifecycle**
  - **Scope:** Automatic authenticated recovery and reliable presence; 60-second disconnected-bidder grace and confirmed host skip; no host transfer; guest Leave Room, host End Room, and 30-minute empty-room expiry.
  - **Acceptance:** Returning player resumes the same seat; timer/board/history remain correct; abandoned attempts roll back safely after eligible host confirmation; original host authority stays fixed; closure/expiry cannot be undone by stale requests; unauthorized rejoin is blocked.
  - **Plan:** Eight ordered subtasks in `docs/tasks/T17-reconnection-and-room-lifecycle.md`. T17.1 reviews contracts, storage, retention and unresolved guest Leave/multi-tab semantics before implementation. Task documents do not authorize coding or deployment.
  - **T17.1:** Complete, owner-approved on 2026-11-01. Accepted: tab-local seat-preserving Leave, protocol v2 with lookup-only historical receipts, ten-second heartbeats/30-second leases, bounded recovery and terminal retention/tombstones.
  - **T17.2:** Complete on 2026-11-01: strict v2 heartbeat contracts, durable per-connection leases/effective absence times, multi-tab seat presence, coordinated alarms and historical receipt lookup. Includes minimal client keepalive for compatibility, not automatic reconnect. All 1,383 workspace tests, type checks and production build passed. No grace skip, departure/closure or empty expiry yet; see its task for warnings/resource limits.
  - **T17.3:** Complete on 2026-11-01: automatic bounded reconnect/watchdog and lifecycle recovery, same-seat refresh via cookie resume, validated per-tab route/pending-command storage, exact explicit retry and entry terminal feedback. All 1,430 workspace tests, types/build and whitespace checks passed, including real frontend-adapter/full Worker HTTP/WSS recovery and lost-move-reply refresh. Owner subsequently confirmed seven guided PC/phone recovery checks through Finished/rematch; exact versions and manual lost-ack reproduction were not recorded. No production backend/game-rule change.
  - **T17.5:** Implemented on 2026-11-02: confirmed guest-only tab departure, retained seat/bids/scores, no auto-resume after refresh, and exact pending retry on explicit same-seat rejoin. Initial checks passed (393 web tests, four full-runtime recovery tests, types/build). Owner subsequently confirmed core Cancel/Leave/refresh/rejoin, bid retention, demonstration/Undo retention and round-result departure. Exact devices and manual multi-tab evidence were not recorded. T17.5 preceded T17.4; no host End Room was added.
  - **T17.4:** Implemented on 2026-11-02: durable attempt/absence-bound 60-second grace, one eligibility revision/alarm, confirmed host-only Skip Attempt, atomic rollback/queue and exact replay. Automated checks passed, and the owner accepted core grace/cancel/skip/rollback/rejoin/Undo/exhausted-queue behavior. Exact devices/manual multi-tab evidence were not recorded. Board/header and white bidding timer remain unchanged; disconnect UI uses yellow clock/icon and muted-red action.
  - **T17.6:** Implemented on 2026-11-02: all-phase host End Room menu/confirmation, atomic terminal revision/receipt/outbox, irreversible Room guards, code invalidation, bounded retry and approved private retention/redaction with minimal tombstones. Read-only authenticated receipt lookup works after closure without WSS or identity renewal. Final full run: 1,506 tests, workspace types/build and whitespace checks passed; known workerd/Windows cleanup warnings remain. Owner browser/phone End Room review is pending. No commit or deployment.
- [ ] **T18 — End-to-end multiplayer tests**
  - **Scope:** Automate a two-browser happy path and representative disconnect/failure cases; manually exercise 2–6 participants where practical.
  - **Acceptance:** Room creation through 10-round result is testable; network retries do not corrupt scores or turns; failures have reproducible diagnostics.

**Review gate:** Two real devices complete a private match without state divergence.

## Milestone 5 — Mobile polish and private deployment

**Outcome:** Friends can open an invite link and play reliably over the internet.

- [ ] **T19 — PWA and mobile lifecycle**
  - **Scope:** Add manifest, appropriate caching of static assets, connection/reconnect feedback, safe-area handling, and iPhone Safari lifecycle checks.
  - **Acceptance:** App loads via normal browser link, optionally adds to home screen, reconnects after phone lock, and clearly explains that live play requires internet.
- [ ] **T20 — Security and operational review**
  - **Scope:** Verify authorization, runtime validation, rate limits, sensitive logging, room expiration, command deduplication, and solver resource limits.
  - **Acceptance:** Documented checks pass; no seat secrets leak to clients other than the owning seat; unsupported actions are rejected.
- [ ] **T21 — Private deployment and smoke test**
  - **Scope:** Deploy web frontend and Worker/Durable Objects, configure URLs, check current free-tier limits, and test invite links on iPhone Safari and Android.
  - **Acceptance:** Host creates room, friend joins from shared link, both finish a match; deployment steps and any recurring costs are documented.

**Review gate:** Private MVP is playable by friends; no public launch is implied.

## Deferred decisions and explicit stop points

Resolve these before the relevant task, not all at project start:

| Decision | Needed before | Why |
|---|---|---|
| Solver time budget and verified fallback | T10 | Carry-forward positions may create hard-to-solve states |
| Tie priority after a player lowers their bid | T15 | Proposed: original first-accepted bid order |
| Maximum bid, nickname length, room code format | T14–T15 | Input validation and usable UI |
| Lifecycle contracts, skip safeguards and cleanup retention | T17.1 | Approved: 60-second grace, no host transfer, 30-minute empty expiry; implementation must preserve fairness/reliability |
| Handling permanent departure and rematch confirmation | T17–T18 | Room lifecycle |
| Current hosting limits and pricing | T21 | Avoid unexpected bills |

## Standard prompt pattern for Codex

Use this template for **one task at a time**:

> Read `AGENTS.md`, `docs/product.md`, `docs/architecture.md`, and `docs/plan.md`. Implement **task TXX only**. First summarize your approach and any ambiguity that could affect product rules. Keep changes within this task's scope. Add or update relevant tests, run available checks, and report changed files, results, and remaining issues. Do not begin the next task, commit, or deploy.

For a task with a significant unresolved decision, ask Codex to **analyze and recommend first**, without implementing until the owner approves.

## Progress log

| Date | Task | Result / notes |
|---|---|---|
| 2026-10-19 | T00 | Complete. Project instructions, product requirements, architecture, and plan are present and aligned. |
| 2026-10-19 | T01 | Complete. All five planned workspaces are scaffolded and resolve locally. Dependency installation, 24 tests across four test projects, workspace type checking, and the web production build pass without adding framework or deployment configuration beyond the existing web scaffold. |
| 2026-10-19 | T02 | Complete. Board/state types, canonical symmetric walls, robot and target definitions, immutable structures, validation helpers, and coordinate documentation are implemented. All 21 engine tests and the workspace type check pass, including direct coverage for the previously noted validation gaps. |
| 2026-10-19 | T03 | Implemented and verified; awaiting owner review. Pure sliding movement covers all four directions, boundaries, walls from either side, blocked cells, robot collisions, nearest obstacles, explicit no-ops, determinism, and input immutability. All 45 engine tests, 48 workspace tests, workspace type checking, and the web production build pass. |
| 2026-10-20 | T04 | Complete. Pure positional target completion supports colored and wildcard targets. Reusable attempt state records successful moves only, derives the current move count, and supports free LIFO undo and reset without mutating inputs. All 70 engine tests, 73 workspace tests, workspace type checking, and the web production build pass. |
| 2026-10-20 | T05 | Complete. The mobile-first read-only React/SVG preview renders the 16×16 grid, blocked center, sample cell-edge walls, continuous boundary, four labeled robots, and colored/wildcard target variants from a validated engine-typed fixture. Browser checks at 320 px, 390 px, tablet, and desktop widths confirm a square board without horizontal overflow. All 73 workspace tests, workspace type checking, and the web production build pass. |
| 2026-10-21 | T08a | Complete; owner visually reviewed and approved the result. Target symbol validation, five reusable SVG symbols, 17 visible demo targets, and white active-cell highlighting are implemented. All 111 workspace tests, workspace type checking, and the production build pass. Only the existing active demo target has a verified solution. |
| 2026-10-21 | T08b | One-board starter catalog and validation implemented. The playable demonstration uses the starter board directly; the separate preview toggle was removed. Irregular target positions, mixed color/symbol assignments, and all four wall-corner orientations are stored as fixed board data. Its active blue star target has a checked two-move blue-robot solution, with undo/reset coverage. Awaiting owner review of the board design. |
| 2026-10-21 | T08b follow-up | Expanded to five boards at the owner's request: Starter Board, Crossroads, Switchback, Pinwheel, and Constellation. Each is defined in its own file with explicit target identities and corner walls. The four additions each include four border-attached single walls. Preserved the owner's extra starter-board wall and kept the demo on that board. All 140 workspace tests, workspace type checking, production build, and whitespace checks pass. The four new designs await owner review; whole-catalog solvability remains T09–T10. |
| 2026-10-21 | T08 completion | Complete for the agreed T08a/T08b scope; owner requested the commit. The demo board is selected with one `DEMO_BOARD_ID` setting, currently `crossroads`; tests follow that selection and separately preserve the starter board's known solution. Final verification: all 140 workspace tests, workspace type checking, web production build, and whitespace checks passed. Whole-catalog solvability remains T09–T10. |
| 2026-10-21 | T09 | Implemented the bounded hidden solver and engine-parity tests. All 185 workspace tests, type checks, web build, and standalone benchmark pass. Normal limits verified 168/170 catalog cases; two larger-budget diagnostics verified the remaining cases. Measurements and proposed fallback are in `docs/benchmarks/T09-solvability.md`. Arbitrary future positions and Cloudflare performance remain unproven. |
| 2026-10-21 | T10 | Implemented pure verified target selection and round setup at the owner's request. Fifty new tests cover filtering, budgets, proof replay, non-repetition, carry-forward snapshots, and unsuccessful outcomes. Twenty-two complete-call measurements exercise all five boards and failure/cutoff paths. The API prepares data without committing official state; live recovery/runtime decisions remain before multiplayer integration. |
| 2026-10-24 | T11.1 | Reviewed lifecycle design and implemented the readonly state/command/result foundation in `packages/match`. Seven contract tests and type assertions pass; all 242 workspace tests, type checks, frozen installation, and web build pass. No reducer behavior is implemented yet; T11.2–T11.6 remain pending. |
| 2026-10-24 | T11.2 | Implemented validated match creation and the real T10 Preparing → Thinking path, with immutable request snapshots, stale/invalid-result rejection, proof replay, atomic reveal, and explicit failed preparation/retry. All 299 workspace tests, type checks, and production build pass. Bidding and later transitions remain T11.3 onward. |
| 2026-10-25 | T11.3 | Implemented the incremental bidding/time/preparation reducer, original bid priority, safe absolute deadlines, shared due-expiry normalization, frozen bidder queue, and fresh first attempt. All 356 workspace tests, type checks, and production build pass; T11.4–T11.6 remain pending. |
| 2026-10-25 | T11.4 | Implemented active-bidder attempt controls, free corrections/no-ops, bid-limit enforcement, give-up rollback, and atomic success/exhausted-bidder resolution. All 385 workspace runtime tests passed; corrected fixture/match checks, workspace type checks, and production build pass. T11.5/T11.6 remain pending. |
| 2026-10-25 | T11.5 | Implemented confirmed current-host no-bid skip, explicit result advancement, ten-round termination, and derived standings/shared winners. All 424 workspace tests, type checks, production build, and whitespace checks pass. T11.6 full-match verification remains pending. |
| 2026-10-25 | T11.6 / T11 complete | Audited transition/rejection coverage and added deterministic real-T10 two-/six-player complete-match tests, immutable sequence replay, and exact runtime export checks. All 192 match tests / 427 workspace tests, type checks, production build, and whitespace checks pass. No production rule fix was needed. T12 remains pending; no UI, deployment, or commit added. |
| 2026-10-25 | T12.1 | Connected the existing demonstration to one local T11 controller, dev-only starter, injected clock, and Act as switching. Added 17 tests; all 444 workspace tests, type checks, frozen offline install, build, and whitespace checks pass. Browser inventory was empty and in-app browser unavailable; manual smoke/device checks remain unverified. T12.2 onward pending; nothing committed. |

| 2026-10-29 | T14.1–T14.7 checkpoint | Implemented persistent room/session infrastructure, authenticated live lobby transport, Create/Join UI, shared connected lobby and room-code copy control. Owner confirmed PC/Android Create/Join and reviewed the lobby/code UI. Full pre-commit verification: 1,129 workspace tests (including 120 server tests with restart/persistence), workspace type checks, production build and whitespace checks passed. Worker runtime emitted known IoContext shutdown/Windows EBUSY cleanup warnings with no test failures. Changed/new-file secret-pattern scan found no matches; local credentials, certificate configuration, storage and generated outputs are ignored. Nothing staged or committed. Live Start and broader T14 verification remain pending. |

| 2026-10-29 | T14.8 | Implemented authenticated host Start, atomic private/public Preparing persistence and replay, board/roster locking and connected read-only Preparing UI. Two-/six-player, rollback, corruption, WSS, exact retry and full runtime restart tests pass; full suite has 1,152 tests. Known Worker shutdown/temporary-cleanup warnings remain documented. No solver, target scheduling, gameplay, deployment or commit added. Owner PC/Android Start review remains pending. |

| 2026-10-30 | T14.9 / T14 complete | Recorded guided owner PC/Android verification and reran all checks: 1,152 tests, workspace type checks, production build and whitespace checks passed. Worker shutdown/cleanup warnings remain documented. Wi-Fi-loss/recovery is explicitly limited (stale online count, development reload/entry return); T17 must address bounded liveness and automatic recovery. No gameplay code, trust settings, staging, commit or deployment changed in this verification. T15/T16 still own live target/bidding/demonstration integration. |

**Next action:** Review the T17 checkpoint and explicitly accept or resolve the remaining broader device-coverage limits before closing all of T17.8. Guided core checks passed: PC-host/phone-guest multi-tab presence, same-host return, bidding/demonstration without host, result waiting/host Continue, round-result refresh, lock/resume, Wi-Fi recovery and final-results refresh on both devices. Automated T17.8 verification passed all 1,530 tests, workspace type checks, production build and whitespace checks. T17.4/T17.5/T17.6 core owner checks passed; the owner confirmed T17.7 expiry with a 10-second local override. T17.8 adds a six-identity combined recovery/host-absence/grace-skip/closure scenario without production-code changes. Unrepeated combined grace/Leave/End variants, reverse-role device coverage, exact current browser versions and iPhone Safari remain unverified. No host transfer. Known runtime cleanup warnings, bootstrap pre-entry refresh and preparation/resource limits remain documented. No commit, deployment, T18 or next task is automatic. Older T12 historical status details need separate reconciliation.
