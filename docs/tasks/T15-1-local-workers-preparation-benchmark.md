# T15.1 — Local Workers Preparation Benchmark

## Status and purpose

Implemented and measured on 2026-10-30; first implementation checkpoint in [T15](T15-server-owned-phases-bidding-and-timers.md).
Measure complete target preparation in the existing local Workers runtime before
wiring search into a live room. No Cloudflare account or deployment is needed.

## Scope

1. Inspect the T09/T10 harnesses, fixtures and raw results, the pure selector and
   existing Worker tests. Reuse deterministic inputs and the pinned local runtime;
   do not add a new benchmark framework or expose a public benchmark endpoint.
2. Add a separately invoked, development/test-only Workers benchmark harness for
   the complete preparation operation, including validation and proof replay.
   Keep fixture construction outside the timed region and document what is timed.
3. Cover all five boards, initial and legal carry-forward positions, shuffled-order
   fixtures with deterministic seeds/orders, hard-first alternate-target success,
   inconclusive search, exhausted aggregate work and unavailable target sets.
   Include a reproducible case exercising the full aggregate cap, not only easy
   successful searches. If a required stress case cannot be produced, report the
   gap rather than claim worst-case coverage.
4. Start with 50,000 expanded / 150,000 retained states per candidate and 200,000
   aggregate expansions. Record results, candidate counts, actual work, cutoff
   reasons, repeated timings and runtime/tool versions. Verify selected proofs
   and unchanged inputs independently of the timed call.
5. Assess room-blocking implications and memory allocation/resource observations.
   Do not label wall time as CPU time, post-call memory as peak memory, or local
   workerd behavior as hosted Cloudflare evidence. Document unavailable metrics.
6. Write a short evidence report and reproducible command in `docs/benchmarks/`.
   Recommend a per-invocation work policy using the measurements. If a smaller
   candidate batch or incremental search is necessary, describe the smallest
   design change and stop for owner review before implementing it.

## Likely files

- A narrowly scoped benchmark harness/fixture in `apps/server` and its script or
  test-only configuration, following existing local runtime conventions.
- Reuse `packages/puzzles` benchmark fixtures/helpers where practical without
  coupling pure runtime code to Cloudflare or browser APIs.
- New T15 benchmark evidence and this task's implementation record.

## Checks and completion

- Deterministic result, budget-accounting, proof-replay and immutability checks.
- Relevant server/puzzle tests and type checks; run the actual benchmark and record
  its command/results. No flaky pass/fail assertions on measured milliseconds.
- Existing production routes and room behavior remain unchanged; no benchmark or
  proof endpoint is reachable by normal clients.

Stop after reporting evidence and the recommended policy. A successful benchmark
does not implement T15.2 or guarantee arbitrary ten-round continuations. Hosted
performance validation remains a separately authorized pre-deployment check.

## Implementation record — 2026-10-30

- Added a separate server `benchmark:round-setup` command, Vitest configuration,
  deterministic fixture builder, test-only Worker/DO and Node measurement harness.
  Production routes, dependencies, gameplay and room behavior are unchanged.
- All 23 scenarios / 69 timed calls passed, including full 200,000-expansion
  stress, all five boards, carry-forward, seed-1501 orders, proof replay, budget
  accounting, input immutability, alternate target and failure cases.
- Round-trip median / p95 / maximum: 7.34 / 52.23 / 130.60 ms. Internal local
  clock measurements are separate, not CPU time. No peak-memory measurement or
  hosted performance claim. See [report](../benchmarks/T15-local-workers-preparation.md)
  and [raw evidence](../benchmarks/T15-local-workers-results.json).
- Recommendation: retain the existing provisional 50k/150k per-candidate and
  200k aggregate policy for the next local checkpoint; no automatic escalation,
  one job, scheduled outside Start/Continue. No batching redesign is justified
  by these samples alone; owner review still precedes T15.2.
- Checks: benchmark passed; puzzle tests 124 passed; existing server tests 133
  passed, including three restart tests; server type checks passed. Existing
  Worker shutdown/Windows cleanup warnings remain documented in the report.
- Final Worker boundary suite: 15 tests passed, including the two new checks
  that `/prepare` and `/baseline` are unavailable; final test/config TypeScript
  check passed. Whitespace and generated-evidence consistency checks passed.
  No full workspace regression/build, UI check, deployment or commit claimed.
