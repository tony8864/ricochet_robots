# T15 — Server-Owned Phases, Bidding, and Timers

## Status and goal

Preparation strategy approved in discussion on 2026-10-30. T15.1 is measured and
T15.2 implements durable bounded server preparation/Thinking reveal and safe
host retry. T15.3 connects preparation feedback/Retry and read-only Thinking;
the owner reported it works. T15.4 adds authoritative bids/deadline, connected
countdown and the initial Demonstrating handoff. T15.5 completed on 2026-10-31:
1,239 tests, type checks, build and whitespace checks passed; the owner confirmed
all seven guided PC/phone checks. No complete networked game is claimed before T16.

Take the durable Preparing match created by T14 through verified target reveal,
Thinking, Bidding and server-authoritative expiry into Demonstrating. Every
connected player sees the same target, bids, deadline and active bidder. Actual
networked movement, attempt resolution and scoring remain T16.

Read `AGENTS.md`, `docs/product.md`, `docs/architecture.md`, `docs/plan.md`,
`packages/shared/README.md`, the T14.8/T14.9 handoff and the requested subtask
before implementation. Work on one explicitly requested subtask at a time.

## Ordered subtasks

- [x] [T15.1 — Local Workers preparation benchmark](T15-1-local-workers-preparation-benchmark.md)
- [x] [T15.2 — Durable bounded target preparation](T15-2-durable-bounded-target-preparation.md)
- [x] [T15.3 — Connected Thinking and preparation feedback](T15-3-connected-thinking-and-preparation-feedback.md) — owner reports it works.
- [x] [T15.4 — Authoritative bids and bidding deadline](T15-4-authoritative-bids-and-bidding-deadline.md) — verified through T15.5.
- [x] [T15.5 — Integration verification and T16 handoff](T15-5-integration-verification-and-handoff.md) — automated checks and owner-guided PC/phone checks passed.

The benchmark is an explicit gate. If it shows that the proposed synchronous
search blocks the room excessively or has unsafe resource usage, stop and review
a smaller batch/search strategy before implementing preparation. Do not treat the
remaining task descriptions as permission to ignore that evidence.

## Approved preparation strategy

- Keep search server-owned, bounded and outside the Start/Continue command's
  synchronous transition. Persist Preparing and its scheduled job before
  acknowledging; run preparation in a subsequent durable scheduled invocation.
- Durable scheduling is not parallel execution. A synchronous solver still
  occupies the room's execution path. Benchmark complete work in the local
  Workers runtime first; local measurements do not certify production limits.
- Use the existing pure selector and independently verified proof, based on the
  locked board, current official robots and unused target IDs. Never reveal an
  unverified or already-satisfied target, or transmit its proof to players.
- Begin benchmarking with the existing provisional policy: 50,000 expansions
  and 150,000 stored states per candidate, 200,000 total expansions per attempt.
  These are not final production resource guarantees or approved increases.
- The server owns shuffled candidate order. Try alternatives within the same
  aggregate budget; do not escalate budgets automatically or search without caps.
- On success, atomically accept the verified result, mark its target used, enter
  Thinking, persist a revision and broadcast the public projection.
- Inconclusive work stays Preparing with deferred feedback. Exhaustively
  unavailable targets stay Preparing with distinct blocked feedback. Operational
  errors are safe, explicit errors, not claims that no solution exists.
- Every unsuccessful outcome preserves board, all official robot positions,
  scores, completed-round count and used target IDs. No automatic reset, board
  replacement, target reuse or consumption of an unrevealed round.
- Permit a host-only, duplicate-safe, stale-protected, cooldown-limited retry for
  deferred work or operational errors. Only one job can be current. No misleading
  Retry for exhaustively unavailable targets. An abort/restart escape is a
  separate product decision, not authorized by this task.
- An identical deterministic retry can return the same result. Reordering may
  reach previously untested candidates but cannot guarantee progress. Do not
  mark untested targets used to change candidate eligibility.

## Integration boundaries

- Reuse pure T10/T11 rules and T13 runtime validation/projection. Extend public
  contracts narrowly for preparation retry and its stale-context guard; no such
  request currently exists. Do not repurpose Start or Continue as Retry.
- Extend the private stored-match codec deliberately: T14 version 1 only accepts
  initial Preparing. Keep old lobby/initial-match data compatible or provide a
  tested explicit migration; never wipe rooms or reconstruct lost match state.
- Coordinate preparation, bidding and existing session-expiry work through the
  Room's alarm scheduling. One purpose must not overwrite another's due work.
- Preserve existing identity, authorization, raw-input bounds, replay protection,
  revisions and durable-before-broadcast ordering. No client clocks, seats,
  host flags or controller actions become trusted authority.
- Thinking has no timer. The first accepted bid starts one 60-second server
  deadline. Any player may bid independently of others and only lower their own
  accepted bid. Equal final bids use original first-accepted order.
- Server expiry creates one frozen bidder queue and fresh initial attempt.
  T15 displays that authoritative handoff but must not enable local demonstration
  controls as a substitute for T16's server implementation.
- Host Skip Round, round-result advancement, synchronized attempts, scoring and
  final-match flow remain T16. Hide unsupported connected actions rather than
  expose buttons that call the local simulator. The preparation service must be
  reusable when T16 later enters Preparing after Continue.
- T17 retains heartbeat/liveness, automatic mobile recovery, host transfer and
  abandoned-attempt grace. Do not claim those from explicit reconnect tests.

## Definition of done and stop point

Record a reproducible local runtime benchmark and the resulting bounded policy.
Two authenticated clients can start, receive a verified target, submit/revise
bids and enter the same Demonstrating state at the persisted server deadline.
Temporary preparation failures have a safe host retry; genuinely unavailable
states remain honestly blocked. Duplicate commands, races and runtime restarts
cannot reveal twice, reset deadlines or lose official state.

Each subtask needs focused tests and type checks. At T15.5 run workspace tests,
type checks, build and whitespace checks; record actual manual device evidence
separately from automated checks and list unavailable checks/known limitations.
No full networked-match claim until T16 and later verification.

No new dependencies, deployment, Cloudflare account setup, certificate/firewall
changes, commit or next-task implementation without a separate request.
