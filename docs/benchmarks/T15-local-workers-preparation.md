# T15.1 — Local Workers Preparation Measurements

## Result and reproduction

The isolated local Workers benchmark passed **23 scenarios / 69 timed calls**:
16 selected a verified target, four deferred and three were unavailable.
All five catalog boards have initial, legal carry-forward and seeded-order cases.
The new stress case consumes the full normal 200,000-expansion aggregate budget.

```powershell
pnpm --filter @robot-puzzle/server benchmark:round-setup
```

This separate command regenerates [raw results](T15-local-workers-results.json).
It is not part of ordinary tests. It bundles a test-only entry and starts a local
Miniflare Worker plus one SQLite-backed Durable Object. Neither entry nor its
binding is in production Wrangler configuration or imported by the game Worker.
No account, deployment, game-room mutation or persisted development data is used.
Production `/prepare` and `/baseline` paths remain unavailable (boundary tests).

## Environment and measurement method

- Measured 2026-10-30 at 10:52:36 UTC on Windows x64 10.0.26200, AMD Ryzen 7
  8845HS, 16 logical CPUs, Node 20.19.4.
- Miniflare 4.20251011.1, workerd 1.20251011.0, Wrangler 4.45.0, Vitest 3.2.7;
  compatibility date `2025-10-11`. No new packages or runtime upgrades.
- Base revision `eacf82d1fe91c27e7be2ed4cf60e473ba62c7885`, dirty working tree.
  Raw metadata records source/bundle/catalog SHA-256 hashes and source paths.
- One untimed warm-up per case, then three serial calls. Runtime startup and
  fixture construction are excluded. Seed 1501 provides deterministic
  Fisher-Yates candidate-order fixtures, not a production randomness policy.
- Main metric: **Node-observed wall-clock round trip**, through Worker forwarding,
  DO request JSON, full `prepareNextRound`, response serialization/transport and
  body consumption. It includes validation, filtering, all candidate searches,
  the selector's independent proof replay and returned snapshots/diagnostics.
- DO internal `performance.now()` deltas are recorded separately. They advanced
  in this local runtime, with coarse millisecond observations; they are not CPU
  measurements or evidence of equivalent hosted clock behavior.
- Each Worker call checks input immutability outside its internal timed interval.
  Node checks deterministic equality with the real Node selector and independently
  replays each selected proof, outside the round-trip interval. Budget accounting,
  stored-state bounds and carry-forward positions are checked, not just outcomes.
- Five warmed no-search round trips measured **3.77–5.24 ms**. They use the same
  starter request/DO forwarding and input-immutability checks, but a smaller
  response; they are context, not an exact overhead correction. No baseline is
  subtracted. No timing thresholds, forced GC, parallel benchmark requests or
  claimed statistical confidence intervals.

## Observed timings and work

Across the 69 round trips, nearest-rank median / p95 / maximum:
**7.34 / 52.23 / 130.60 ms**. These summarize this fixture mix, not production
traffic or worst-case latency. Easy cases dominate the median; see stress below.

| Scenario | Actual expansions | Result | Round-trip range | Internal clock range |
| --- | ---: | --- | ---: | ---: |
| Constellation hard target first, then alternative | 67,457 | Selected | 47.70–52.23 ms | 42–48 ms |
| Only Constellation yellow crescent unused | 50,000 | Deferred | 34.33–41.80 ms | 31–38 ms |
| Trapped-red full aggregate stress | 200,000 | Deferred | 123.52–130.60 ms | 120–126 ms |
| Small aggregate limit | 8 | Deferred | 2.96–3.43 ms | See raw data |
| Retained-state cutoff | 17 | Deferred | 4.51–5.74 ms | See raw data |
| All robots isolated | 17 | Unavailable | 9.99–22.25 ms | See raw data |
| Every target used | 0 | Unavailable | 2.53–2.86 ms | See raw data |
| Sole unused target already satisfied | 0 | Unavailable | 2.35–3.29 ms | See raw data |

The full-cap fixture is a catalog-valid test board derived from Starter with a
wall angle enclosing red in its initial corner. Other robots remain mobile;
only the four red targets are unused. Four real searches each expand 50,000
states and return unknown at the expansion limit. This is not a mocked solver,
not registered as a playable board and not proof of the worst possible position.
Although humans can see the trapped-red obstruction, the bounded solver correctly
reports unknown rather than claiming exhaustive impossibility.

Hard-first asserts an unknown candidate followed by a solved alternative. Small
aggregate asserts allowances of five then three, not a fresh budget per target.
The isolated case exhausts all eligible searches; used/already-satisfied cases
perform no searches. Every unavailable/deferred case preserves its input.

## Memory and blocking interpretation

Normal candidate searches allocate exactly **1,350,000 bytes** of typed search
arrays (150,000 retained slots × nine bytes). The largest observed retained-state
count was 113,360. Arrays exclude the visited Set, movement index, validation,
objects, runtime and transport overhead. The stress attempt allocates four such
array groups sequentially (5.4 MB cumulative allocation), not a measured 5.4 MB
peak. Failed/quick searches can also allocate full arrays; many candidates and GC
matter even when expansion counts are low.

No reliable isolate peak-memory, heap or CPU profiler was collected. No Node
process RSS is presented as DO memory. This run does not establish a hosted memory
margin, throughput across rooms or interference under simultaneous player traffic.

The operation remains synchronous: scheduling it later does not make it parallel.
The measured full-cap invocation occupies the DO search path for roughly 120 ms
locally; commands can wait behind it. This harness does not separately measure
queued-player latency, alarm delivery, persistence or WebSocket broadcasts.

## Recommendation and review gate

For the next **local implementation checkpoint**, retain the existing provisional
50,000 expanded / 150,000 retained states per candidate and **200,000 aggregate
expansions per preparation attempt**, sequential searches, one current job and
no automatic budget escalation. Run once in a subsequent durable invocation,
outside Start/Continue; preserve explicit deferred/unavailable/error outcomes.

These samples do not justify a new search service, new dependency or incremental
solver rewrite now. A roughly 131 ms measured round trip during Preparing is a
reasonable starting point for owner review, not an approved latency SLA or proof
that every input is safe. Expansion bounds are work limits, not wall-clock limits;
a synchronous search cannot be interrupted by a normal timer. T15.2 must retain
resource bounds, cooldown/duplicate protections and bounded crash recovery.

If owner review or integration measurements require less blocking, the smallest
next design to review is fewer candidates/expansions per scheduled invocation,
with private durable progress and unchanged aggregate logical-attempt budget.
That requires explicit candidate-progress handling; don't fake used targets or
silently reset the aggregate allowance. It is not implemented in this benchmark.

Before deployment, separately validate CPU/memory and latency under the intended
hosted environment/plan. No hosted guarantees, arbitrary ten-round solvability,
automatic failure escape or live preparation integration follow from these tests.

## Verification

- Benchmark: one test, 23 cases, 69 timed calls, all assertions passed.
- Puzzle regression suite: 124 tests passed.
- Existing server suite: 130 Worker tests + three full-runtime restart tests
  passed. Known IoContext cancellation and Windows EBUSY shutdown-cleanup warnings
  occurred, with exit zero. No broad temporary-directory cleanup was attempted.
- Server type checks passed, including benchmark test/config files.
- Final production-boundary suite: 15 tests passed, including two new unavailable
  benchmark-path assertions; final test/config type check passed. Whitespace and
  generated-evidence consistency checks passed.
- No UI/device test, full workspace test run or production build is claimed for
  this test-only change. T15.2 has not been started.
