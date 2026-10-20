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

## Milestone 3 — Modular boards, solver, and local match

**Outcome:** Ten-round rules work locally before adding networking.

- [ ] **T08 — Four original quadrants and assembly**
  - **Scope:** Define four original 8×8 quadrant datasets and compose a valid 16×16 board with rotations/rearrangements, target transformations, and the blocked central 2×2.
  - **Acceptance:** Assembly tests verify transformed walls/targets, seam integrity, no overlaps, and valid robot-start cells; board remains constant throughout a match.
- [ ] **T09 — Solvability validator spike and benchmark**
  - **Scope:** Prototype a hidden solver that verifies at least one solution for a target from *current* robot positions. Measure performance on representative states; identify a bounded fallback policy.
  - **Acceptance:** Demonstrated solvable/unsolvable fixtures; measured time and search limits recorded; no unverified target is declared solvable. **Do not proceed to live round generation until the fallback is approved.**
- [ ] **T10 — Target selection and round setup**
  - **Scope:** Select unused, verified-solvable targets from official robot positions; define behavior if validation times out or candidates are exhausted according to the approved fallback.
  - **Acceptance:** Tests prove no target repeats, selected targets are verified from carry-forward positions, and the system does not hang or reveal an unverified target.
- [ ] **T11 — Pure match state machine**
  - **Scope:** Implement lobby-independent match phases, 10-round progression, scores, bidder order, demonstration attempts, success/failure transitions, and match results using injected time for tests.
  - **Acceptance:** Tests cover successful carry-forward of **all four** robot positions, failure rollback to round-start, no-bid skip, equal top scores, and 10-round completion.
- [ ] **T12 — Local bidding and match UI**
  - **Scope:** Add thinking, 60-second bidding, demonstration, round result, and final score views using local state for development only.
  - **Acceptance:** A simulated group can play a complete 10-round match locally; no robot movement is possible during thinking/bidding; higher bids from other players remain allowed.

**Review gate:** Complete local match with correct transitions; solver performance/fallback reviewed by owner.

## Milestone 4 — Authoritative multiplayer

**Outcome:** Two or more browsers can play a synchronized private room.

- [ ] **T13 — Typed protocol and validation**
  - **Scope:** Define commands, snapshots, revisions, rejection reasons, and runtime message validation in `packages/shared`.
  - **Acceptance:** Invalid messages are rejected; types and schemas are tested; credentials are excluded from broadcast snapshots.
- [ ] **T14 — Room creation, seats, and invite flow**
  - **Scope:** Create/join private rooms with short codes and URLs, nicknames, unguessable seat credentials, 2–6 player cap, host assignment, and lobby roster.
  - **Acceptance:** Two browsers can join; invalid credentials cannot impersonate a seat; a started room rejects new players but accepts returning seats.
- [ ] **T15 — Server-owned phases, bidding, and timers**
  - **Scope:** Add a Durable Object room state machine and persistent server deadlines; process bid commands atomically and reject late or unauthorized actions.
  - **Acceptance:** Tests cover first-bid 60-second deadline, higher bids by different players, lowering only one's own bid, equal-bid priority, and expiry races; clients cannot control timer authority.
- [ ] **T16 — Synchronized demonstration and scoring**
  - **Scope:** Validate moves, undo, reset, give-up, bid limits, and winning commits on the server; broadcast authoritative revisions.
  - **Acceptance:** Two browsers see the same robot positions and scores; only active bidder controls movement; failed attempts roll back; successful positions carry into next round; duplicate commands do not apply twice.
- [ ] **T17 — Reconnection and host continuity**
  - **Scope:** Restore seat and authoritative snapshot after mobile backgrounding/WebSocket loss; implement approved grace period, host transfer, and room expiry behavior.
  - **Acceptance:** Returning player resumes same seat; timer and board remain correct; an abandoned active attempt resolves predictably; unauthorized rejoin is blocked.
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
| Final quadrant geometry and target locations | T08 | Original content and correct board assembly |
| Solver time budget and verified fallback | T10 | Carry-forward positions may create hard-to-solve states |
| Tie priority after a player lowers their bid | T15 | Proposed: original first-accepted bid order |
| Maximum bid, nickname length, room code format | T14–T15 | Input validation and usable UI |
| Disconnect grace, host skip safeguards, room expiry | T17 | Fairness and reliability |
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

**Next action:** Select and explicitly request **T06**; do not begin it automatically.
