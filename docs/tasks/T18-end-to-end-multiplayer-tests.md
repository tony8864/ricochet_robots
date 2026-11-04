# T18 — End-to-End Multiplayer Tests

## Status and goal

Complete with owner-accepted coverage limits on 2026-11-04, after T17's implementation, automated verification and guided core
PC/phone checks. T18.1's isolated browser harness, T18.2's entry/lobby browser
flows, T18.3's real-time round flow, T18.4's mixed ten-round/rematch and six-seat
cases, and T18.5's recovery/failure browser checks are implemented. T18.6's final
automated pass on 2026-11-03 verified 11 browser cases, 1,530 existing tests,
types/build/whitespace. On 2026-11-04 the owner confirmed all seven guided PC/phone
gameplay/recovery/results/rematch checks passed, satisfying the core two-device
gate by owner report. The owner explicitly accepted closure with broader device/
version coverage still unverified. This does not certify those missing cases.
T17's broader device limits remain visible,
not implied passes.

Verify the real rendered application from Create/Join through ten-round results
and lobby return, plus representative recovery/failure paths. Existing pure,
Worker and frontend-adapter tests remain valuable; this task adds browser-driven
evidence rather than replacing or duplicating their entire rule matrix.

Read `AGENTS.md`, product, architecture, plan, the shared protocol README and the
selected subtask before implementation. Work on one requested checkpoint at a
time. Writing this plan does not authorize implementation, dependency installation,
trust changes, commit, deployment or T19.

## Ordered checkpoints

- [x] [T18.1 — Browser harness and isolated test environment](T18-1-browser-test-harness.md)
- [x] [T18.2 — Entry and lobby browser flow](T18-2-entry-and-lobby-browser-flow.md)
- [x] [T18.3 — Bidding and demonstration browser flow](T18-3-round-gameplay-browser-flow.md)
- [x] [T18.4 — Ten-round results and rematch](T18-4-full-match-browser-flow.md)
- [x] [T18.5 — Browser recovery and failure cases](T18-5-browser-recovery-and-failures.md)
- [x] [T18.6 — Device verification and final handoff](T18-6-device-verification-and-handoff.md) (automated/core PC-phone checks passed; limits accepted)

Each checkpoint adds a runnable, reviewable result. T18.1–T18.5 primarily involve
test/harness code; T18.6 primarily involves executing checks and recording evidence.
Fix an exposed bug only within a small reviewed scope; do not redesign the game.

## Test boundaries

- Drive the rendered production-connected UI with independent browser contexts
  and cookie jars for different players. Shared-context tabs intentionally test
  the same identity. Never authenticate by nickname, seat ID or code alone.
- Use a fresh isolated local runtime/storage and owned ports, not the owner's
  development rooms, browser profile, certificates or running server processes.
  Any new runner and compatible version must be reviewed before installation.
- Start with two players; add a focused six-player scenario rather than running
  every expensive browser test six ways. Distinguish six contexts from six devices.
- Keep actual ten-round rules, 60-second bidding, 60-second bidder grace and
  30-minute empty expiry. If controlled time is needed, review an isolated
  test-only server-clock fixture in T18.1. A browser clock alone cannot advance
  server deadlines. Never add production debug endpoints or modify `.dev.vars`
  silently. A real-time fallback is acceptable if isolation cannot be guaranteed.
- Preparation must use the real validator and unchanged budgets. Deterministic
  catalog/selection fixtures may make routes reproducible, but cannot inject
  accepted game state, fabricated results or player-accessible solver proofs.
  A preparation failure must be reported, not bypassed with weaker rules.
- Observe accessible names and rendered state; add minimal stable test selectors
  only when needed. Accepted positions, bids and scores come from server snapshots.
- Use condition-based waits and controlled deadlines, not arbitrary sleeps or
  excessive retries masking races. Restore/clean only resources this run owns.
- Failures need useful scenario/step context and bounded diagnostic artifacts.
  Traces/network logs can contain cookies and private data: keep local ignored
  artifacts, sanitize before sharing, never commit credentials or private proofs.

## Evidence and completion

Record the exact commands, runner/browser versions, counts and failures/fixes.
Separate rendered-browser automation, adapter tests, full runtime recreation and
physical-device observations. Existing T17 restarts do not prove an actual process
restart inside a browser test. Desktop WebKit/mobile emulation is not an iPhone
Safari device pass.

Acceptance: two independent browsers can complete Create/Join → ten rounds →
identical final standings → same-room lobby return; representative recovery and
failures preserve turns/scores/positions and provide reproducible diagnostics.
Manually exercise 2–6 participants where practical, recording unavailable device
coverage openly. The milestone's two-real-device full-match gate remains distinct
from automation and from a sequence consisting only of skipped rounds.

Security/operational review is T20, PWA work is T19, deployment is T21. T18 tests
existing authorization/retry protections but does not certify production security,
hosting costs or arbitrary carry-forward solvability. Stop at the requested
checkpoint and request direction for architectural/gameplay changes.
