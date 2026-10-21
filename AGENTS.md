# AGENTS.md — Codex Working Instructions

## Project

Build a private, mobile-first multiplayer sliding-robot puzzle game for 2–6 friends.

Read these documents before changing code:
1. `docs/product.md` — authoritative gameplay and UX requirements.
2. `docs/architecture.md` — intended boundaries, stack, and state ownership.

If these documents conflict, **product rules win**. Explain the conflict and ask before making a consequential assumption. Do not quietly change game rules.

## Working method

- Work on **one small, verifiable task at a time**. Do not implement the entire application from a broad request.
- Before coding, briefly state the intended approach, files likely to change, and how the result will be tested.
- Make the smallest coherent change that completes the requested task. Avoid unrelated refactors, new dependencies, or speculative features.
- When a decision is missing, prefer a simple reversible implementation choice; ask if it affects gameplay, fairness, security, or architecture.
- Do not overwrite unrelated user changes. Inspect existing code and conventions first.
- Keep changes easy to review. Do not commit, deploy, or modify infrastructure unless explicitly requested.
- Do not claim tests passed unless they were actually run. If a command cannot run, report why.

## Technical boundaries

- TypeScript throughout; use the existing pnpm workspace setup once present.
- Frontend: React PWA, mobile-first portrait UI, SVG board.
- Backend: Cloudflare Worker + Durable Object per room, authoritative for room state and all accepted game actions.
- Shared engine: **pure, deterministic TypeScript**, independent of React, Cloudflare, browser APIs, timers, and networking.
- Shared network contracts must be runtime-validated at the server boundary; TypeScript types alone are insufficient.
- Keep the board representation consistent: integer coordinates and blocked cell edges, with explicit coordinate conventions.
- Do not add a database, state-management framework, UI kit, or monorepo orchestration tool without a demonstrated need.
- Avoid introducing accounts, matchmaking, chat, AI opponents, hints, monetization, or public features.

## Non-negotiable gameplay rules

- Board: 16×16, selected from a catalog of original full-board designs, with a blocked central 2×2 area. The host may preview/shuffle boards in the lobby; the selected layout stays fixed for all 10 rounds.
- Each board has 17 targets: star, crescent, triangle, and square in each robot color, plus a vortex wildcard. All targets remain visible; a white cell outline marks the active target.
- Four sliding robots; walls, board edges, blocked cells, and other robots stop movement.
- No-op directional inputs do not count as moves.
- Ten rounds per match; each round reveals a target solvable from the **current official robot positions**.
- During thinking/bidding, players see a read-only board; no interactive simulation.
- The first accepted bid starts a **60-second server-authoritative bidding window**.
- **Every player may submit any positive integer bid regardless of other players' bids.** A player may lower their *own* bid but not raise it. No new or revised bids after the window closes.
- Demonstration order: lowest final bid first; ties resolved by earlier first accepted bid.
- Only the active bidder may move robots during a demonstration. No demonstration timer.
- Undo and reset are free. Success requires reaching the target in **at most** the number of moves bid.
- A failed/given-up attempt restores **all robots to round-start positions** before the next bidder tries.
- A successful attempt awards one point and commits **all four robots' final positions** as the next round's starting positions.
- If nobody succeeds, the round awards no point and the official positions remain unchanged.
- New players cannot join a started match; existing players may reconnect to their seats.
- The server, never a client clock or local UI state, determines deadlines, move validity, turns, and scores.

If an implementation request contradicts one of these rules, flag it before proceeding.

## Correctness and tests

- Add or update tests for every meaningful game-engine rule or room-state transition.
- Prioritize tests for walls, robot collisions, blocked moves, target matching, undo/reset, bid ordering, timer boundaries, failure rollback, successful carry-forward, and reconnection.
- Prefer unit tests for pure functions and state machines; add integration/E2E tests when a task crosses client/server boundaries.
- Use deterministic fixtures and controlled clocks in tests. Avoid flaky real-time sleeps.
- Run relevant tests and type checks before reporting completion, when the environment permits.
- Keep puzzle solvability validation separate from UI and benchmark it before assuming it is fast enough for live rounds.
- Do not present an unverified target as guaranteed solvable.

## Security and reliability

- Treat every network message as untrusted: validate payloads and authorize commands against the server's current phase and seat.
- Seat identity must rely on an unguessable credential, not a nickname or room code alone.
- Never broadcast session credentials, embed secrets in client code, or log sensitive tokens.
- Account for mobile Safari backgrounding and dropped WebSockets. On reconnect, use an authoritative state snapshot.
- Make command retries/duplicates safe, especially bids and movement actions.
- Keep essential room state durable across object restarts.

## UX expectations

- Test responsive behavior for narrow phone screens and iPhone Safari.
- Make the board legible and square, with controls below it.
- Do not rely on color alone to distinguish robots or targets.
- Clearly indicate phase, active player, bid, move count, target, and connection status.
- Multiplayer requires connectivity; cached PWA assets must not imply offline play is supported.

## Definition of done for a Codex task

A task is complete when:
1. Requested behavior is implemented without unrelated scope expansion.
2. Appropriate tests are added or updated.
3. Relevant checks are run, or blockers are explicitly reported.
4. Any product/architecture deviation is called out.
5. The final response briefly states **what changed, files touched, tests run/results, and remaining risks or follow-ups**.

## Documentation maintenance

- Update `docs/product.md` only for an explicitly approved product-rule change.
- Update `docs/architecture.md` when an approved architectural decision changes.
- Keep documentation and tests aligned with actual behavior.
- Do not silently reinterpret ambiguous requirements.

## Initial implementation sequence

Unless instructed otherwise:
1. Workspace scaffold and shared game-engine package.
2. Pure board and robot movement model with tests.
3. Local SVG board and demonstration controls.
4. Full-board catalog data, match rules, and puzzle validation benchmarks.
5. Authoritative multiplayer room and protocol.
6. Mobile reconnection, integration tests, and private deployment.

Each numbered phase should be broken into smaller tasks; never treat the entire sequence as one Codex assignment.
