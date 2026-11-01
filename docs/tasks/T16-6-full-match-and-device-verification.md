# T16.6 — Full-Match and Device Verification

## Status and purpose

Complete: automated verification passed and the owner reported all eight manual
checks working on 2026-11-01.
Follows [T16.5](T16-5-retries-restarts-and-permission-verification.md).
Verify the complete connected T16 slice and record its exact remaining limits.
Do not mark all multiplayer/mobile/deployment work complete from this checkpoint.

## Automated composition

1. Compose actual identity/create/join/Start, bounded verified preparation, bids/
   expiry, attempts, results, host advancement, Finished and return-to-lobby for
   two and six seats. Use deterministic valid fixtures and controlled clocks.
2. Include colored/vortex targets, helper-robot solutions, free blocked directions,
   Undo/Reset, a bid-limit correction, immediate Give Up, next bidder rollback,
   success below/at the bid, exhausted queue and confirmed Thinking skip.
3. After each transition assert one authoritative phase, consistent positions/
   history/count, one-point maximum award per round, nonrepeating targets and the
   exact all-four official carry-forward. Finish exactly ten rounds; no eleventh
   target, extra point or automatic round-one rematch.
4. Replay representative commands and restart mid-flow using T16.5's infrastructure.
   Include positive winner/tie and no-winner result paths. Do not replace server
   actions with a client reducer to make a networked test pass.
5. Test drivers may use privately computed/replayed proofs to choose requests, but
   must not expose a solution endpoint/UI or change production target selection.
   If preparation defers/unavailable blocks a fixture, report it; do not silently
   raise budgets, reset positions, reuse targets or consume an unrevealed round.

Run workspace tests/type checks/build/whitespace checks and record actual results.
Fixture success does not guarantee any possible carry-forward state can finish
ten rounds, nor certify hosted resource usage.

## Owner-guided checks

List the checks first, then guide one checkpoint at a time using the existing
approved PC/phone HTTPS setup. No certificate/firewall changes or deployment.

1. Host/guest permissions: only active bidder gets movement controls; no private
   simulation in Thinking/Bidding or spectator view.
2. Movement/corrections: both devices match positions/count; no-op is free;
   Undo/Reset work and over-limit movement still permits corrections.
3. Interaction/animation: robot selection is local/instant; rapid taps are not
   queued, ordinary accepted moves and Reset animate directly; bidder changes,
   rebind and missed versions snap appropriately,
   and Give Up has no confirmation.
4. Queue rollover: Give Up restores all four start positions for the next bidder;
   exhausted bidders produce the same no-point result on both devices.
5. Success/carry-forward: one point, correct modal, host-only Continue and the
   next verified target starting from all four final positions; Skip only in
   Thinking with confirmation and no score/robot changes.
6. Explicit reconnect/backend restart during demonstration or result: preserve
   seat, attempt/history/version, positions, score and pending-request outcome.
7. Complete ten rounds and view final results on both devices; verify New Match
   returns the same players/host/code to lobby for preview/shuffle/new Start.
8. Phone readability, square board, minimum touch targets, connection/retry access
   inside modal, reduced-motion behavior and no horizontal overflow. Record actual
   device/browser details; iPhone Safari remains unverified unless exercised.

Record owner reports separately from agent-run checks. A shortened test fixture
is not a manual ten-round pass, and explicit rejoin is not automatic mobile recovery.

## Documentation and completion gate

Update task/plan/architecture/development notes to actual implementation. Record
storage/attempt-version decisions, approved protocol metadata (if any), all test
evidence and unresolved issues. Keep hosted solver/resource limits, unavailable
preparation escape, T17 recovery/host continuity and later E2E/security/deployment
work explicit. Do not modify product rules without approval.

T16 completes when the requested behavior and verification gates pass or the
owner explicitly accepts documented limitations. Leave a pending manual gate
open instead of inventing evidence. Stop before T17, commit or deployment unless
separately requested.

## Automated evidence (2026-11-01)

`apps/server/test/fullMatch.test.ts`, registered in the Workers Vitest suite,
drives real session/create/join HTTP requests and authenticated WebSocket commands.
It is network lifecycle verification, not rendered-browser or physical-device E2E.
Three scenarios each complete exactly ten rounds: two-player positive winner,
six-player positive tie, and two-player no winner. Every seat receives the same
runtime-validated authoritative snapshots.

Coverage includes colored/vortex targets, helper-robot movement, blocked no-ops,
Undo/Reset, rejection at the bid limit followed by correction, immediate Give Up,
all-four rollback, success below/at bid, exhausted queues, Thinking Skip, host-only
Continue, exact retries, nonrepeating targets, score deltas and all-four official
carry-forward. Finished does not prepare an eleventh target. New Match retains
room/code/host/roster, returns to lobby without auto-start, and an explicit fresh
Start creates a clean match. Replaying the old Start cannot restart it.

The driver controls the server clock and random selection inputs to exercise a
valid catalog-board/target sequence reproducibly. Privately computed proofs choose
requests; production preparation, budgets, reducers, authorization and persistence
still execute. It never injects round results, scores or robot positions and adds
no production endpoint or UI. This fixture is not evidence of arbitrary ten-round
solvability or hosted resource performance.

Mid-attempt recovery here closes sockets, reconstructs the storage-backed
`LiveLobby` transport controller, explicitly rebinds authenticated clients and
checks private history/version plus exact move replay. This is **not** a full
Worker/Room process restart within the ten-round script. Independent T16.5
full-runtime shutdown/recreation tests cover persisted demonstration/corrections,
scored results, Finished, lobby return and replay retention.

Development failures: an attempted forced Durable Object abort stalled the test
runtime and was removed; a Finished state-request helper incorrectly included
match context and was corrected to the strict wire contract. No production rule,
search budget or error handling was changed to bypass either failure.

The three initial complete scenarios passed in approximately 7.8s, 20.3s and 5.4s
respectively (whole-test local wall times, not CPU/resource benchmarks). Final
workspace verification after the additional invariant checks passed:

- `pnpm test`: 1,349 tests (engine 102, puzzles 124, match 192, shared 390,
  web 317, server 224 including 17 separate full-runtime persistence cases).
- `pnpm typecheck`: all workspace packages passed.
- `pnpm build`: production web build passed.
- `git diff --check` and a separate trailing-whitespace check of the new test:
  passed.

Known Windows Workers-pool `EBUSY` temporary-directory cleanup warnings remain;
they did not fail assertions or the command. No broad temporary cleanup was done.

On 2026-11-01, after receiving the eight-item manual checklist, the owner reported
"it all works." This closes the owner-guided gate for permissions, movement and
corrections, interaction, bidder rollover, success/progression, explicit recovery,
the full-match/rematch flow and phone usability. This is owner-reported evidence,
not agent-observed browser execution. Exact device/browser versions and individual
recovery timings were not supplied. Do not infer an iPhone Safari pass, automatic
mobile recovery or hosted resource validation from this report.

T16.6 and T16 are complete within their documented scope. T17 recovery/liveness/
host continuity and the existing preparation/resource limitations remain separate.
No commit or deployment was requested by this confirmation.
