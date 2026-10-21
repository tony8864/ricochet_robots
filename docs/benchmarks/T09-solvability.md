# T09 — Solver measurements and recommendation

## Result

The bounded solver and benchmark are implemented. At 50,000 expanded / 150,000
stored states per search, 84 of 85 initial cases and 84 of 85 carry-forward
cases were solved. Both unknown cases were solved with a separately measured
200,000 expanded / 500,000 stored cap. Every returned path was independently
replayed with `moveRobot` and checked with `isTargetComplete`.

This verifies these exact 170 board/position/target combinations, **not every
possible carry-forward state or a guaranteed ten-round continuation**. No
catalog case was proven unsolvable. The small impossible fixture was.

## Reproduction and environment

```powershell
pnpm --filter @robot-puzzle/puzzles benchmark:solver
```

The command regenerates [raw results](T09-solvability-results.json), including
each case's limits, moves, statistics, timing/memory samples, and carry-forward
positions/proofs. Timings below are from 2026-10-21, 14:45:46 UTC.

- Node v20.19.4; Vitest 3.2.7; Windows x64, release 10.0.26200.
- AMD Ryzen 7 8845HS, 16 logical CPUs, 29,860,155,392 bytes reported system RAM.
- Base revision: `e0f590934f805b85ec597dab2bf657c11cc87238`, with uncommitted T09
  changes. The raw metadata lists the fingerprinted files.
- Solver/harness source SHA-256 (LF-normalized):
  `71d683ae45387585fe1940affbef52e8a51b73cf3c289e7dd1dfdd20111d6b99`.
- Serialized catalog SHA-256:
  `64b1c53223d5e55ed6c828a86651b95b61c3f4f4d281aa9baa431d09ac5cedf4`.
- One serial runner, one warm-up and three measured repetitions per case;
  no forced garbage collection or timing assertions.
- Each timing includes state validation, search-array allocation, geometry
  setup, search, and path reconstruction. Witness replay and assertions are
  outside the timed region. No cross-call geometry or proof cache is used.
- Percentiles use nearest rank across all measured calls in the category,
  including unknown/unsolvable results. They are not per-board latency promises.

## Baseline and optimization

The first implementation used engine movement for every successor. An initial
measurement found roughly 80–95 ms for 1,000 expansions on harder samples,
justifying a local optimization: precompute static wall stops once per search
and check three robot blockers per move. The game engine itself is unchanged.

The retained engine baseline and indexed implementation use identical BFS,
budgets, state identity, and traversal order. The benchmark compares the first
target on each board at 1,000 expanded / 10,000 stored states, requiring equal
outcomes, paths, and statistics:

| Implementation | Cases | Solved / unknown | Median ms | p95 / max ms |
| --- | ---: | ---: | ---: | ---: |
| Engine-movement baseline | 5 | 2 / 3 | 81.55 | 84.16 |
| Indexed wall stops | 5 | 2 / 3 | 1.22 | 2.42 |

These are representative bounded samples, not a universal speedup claim.
Differential unit tests additionally compare all 16 moves on every legal-cell
placement fixture and deterministic legal walks across all five catalog boards
and two small boards with extra blocked cells.

## Full catalog and carry-forward measurements

Normal cap: 50,000 expanded states, 150,000 stored states. Each board contributes
17 initial cases and 17 carry-forward cases. Carry-forward fixtures are the
replayed final positions after the first colored target solved in catalog order
(red star for all five in this run). The complete proofs and all four positions
are stored in the raw evidence. This is fixture preparation, not round-selection
logic. The completed red star is deliberately included as an empty-path case;
T10 must decide whether to exclude already-satisfied targets.

| Group | Cases | Solved | Unknown | Median ms | p95 ms | Max ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial positions | 85 | 84 | 1 | 1.99 | 22.93 | 68.82 |
| Carry-forward positions | 85 | 84 | 1 | 2.66 | 36.71 | 81.83 |

| Board (initial + carry-forward) | Solved / cases | Median ms | p95 ms | Max ms |
| --- | ---: | ---: | ---: | ---: |
| Starter Board | 34 / 34 | 1.90 | 21.15 | 27.17 |
| Crossroads | 34 / 34 | 2.51 | 20.10 | 58.21 |
| Switchback | 34 / 34 | 2.25 | 22.93 | 36.71 |
| Pinwheel | 34 / 34 | 3.01 | 26.25 | 46.77 |
| Constellation | 32 / 34 | 2.14 | 67.23 | 81.83 |

All normal-cap solved paths contain 0–11 moves. The largest observed search had
50,000 expansions, 464,313 non-no-op generated successors (including repeated
states), and 118,442 retained states. No normal catalog case hit the storage cap.

Both unknowns are Constellation's yellow crescent and hit the expansion cap:

| Positions | Generated successors | Retained states | Result at normal cap |
| --- | ---: | ---: | --- |
| Initial | 455,541 | 113,360 | Unknown |
| After red star | 464,313 | 118,442 | Unknown |

Separate diagnostics at 200,000 expanded / 500,000 stored states:

| Positions | Outcome | Moves | Expanded | Generated | Retained | Elapsed range ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Initial | Solved | 12 | 196,879 | 1,847,949 | 420,234 | 326.66–331.47 |
| After red star | Solved | 10 | 56,211 | 523,818 | 132,377 | 83.66–91.92 |

Thus the earlier cutoffs were not evidence of impossibility. The larger search
is materially more expensive and is not silently applied by the solver API.

The harness also checks a helper-robot solution, an exhaustive two-state
impossibility, deliberate work/storage cutoffs, and initial completion. The
starter's known two-move blue-star solution is asserted among the catalog cases.
There are 187 benchmark cases total, each with one warm-up and three measured
calls. The standalone run passed in about 8.5 seconds including runner startup.

## Memory and boundedness

- Main search arrays allocate exactly 1,350,000 bytes (about 1.29 MiB) per
  normal-cap search, plus 1,024 bytes for indexed stops. The visited Set and JS
  overhead are additional. Zero-work/already-complete returns allocate no search
  arrays. The larger cap reserves 4,500,000 search-array bytes (about 4.29 MiB).
- Retained-state caps bound the visited Set's entry count as well as queue/parent
  storage. No full paths or decoded robot objects are retained per node. A goal
  is returned without storing another search node.
- Before/after process snapshots are observations, **not per-search peak-memory
  measurements**. The runner, catalog, JIT, previously allocated buffers, and
  garbage collection all contribute. No reliable Set-overhead estimate is made.
- Maximum observed process heap/RSS after normal catalog calls was about
  58.61 / 147.74 MiB; including larger diagnostics it was about 83.96 / 171.33 MiB.
  Do not interpret these process figures as the solver's incremental requirement.
- The pure search has no clock. A call attempts at most 16 moves per allowed
  expansion, with fixed-size board preprocessing. Limits bound deterministic
  work, not elapsed time; a timer cannot interrupt a synchronous call.

## Proposed budget and fallback — owner approval required

1. Use 50,000 expansions / 150,000 stored states as a **provisional per-candidate
   starting budget**, not a default hidden inside the API. Measure it in the
   actual server runtime and under concurrent room load before enabling it.
2. For an unknown or proven-unsolvable candidate, consider another unused target
   from the same board and unchanged official positions. A proposed aggregate
   round-setup ceiling is 200,000 actual expansions across candidates, with one
   search active at a time and no more than the finite unused-target count.
   This aggregate policy is not implemented or latency-validated by T09.
3. Reuse a cached proof only for the exact versioned geometry, all four current
   positions, and target requirement/location; replay it before trusting it.
   Initial-position proofs do not transfer automatically to later rounds.
4. If no unused candidate is verified within the aggregate budget, keep the next
   target unrevealed and preserve the board, positions, scores, and round count.
   Report a recoverable setup/validation-pending state. The proposed recovery is
   a separately bounded background/offline validation pass, not blocking the
   authoritative room on an unrestricted search. Its runtime placement and UX
   must be agreed before T10. If no candidate can ever be verified, do not claim
   the match can always continue.

Never reveal an unverified target, reset robots, switch boards, recycle targets,
or count an unrevealed puzzle as a skipped round to conceal a search failure.
The 200,000 / 500,000 diagnostics are useful for offline investigation, but the
~330 ms local outlier argues against making them an automatic synchronous retry
inside a room. Local Node results establish no Cloudflare CPU/memory entitlement
or latency guarantee; that runtime has not been benchmarked here.

No player-facing solver, hints, UI changes, proof-cache integration, or live
target selection was added. **Do not begin T10 until the owner reviews and
approves the budget/fallback and resolves already-satisfied target handling.**

## Verification

- Puzzles unit tests: 74 passed, including 45 new solver/parity tests.
- Workspace tests: 185 passed.
- Puzzles and workspace type checks: passed, including the benchmark harness.
- Web production build: passed; application entry points do not import the solver.
- Standalone benchmark: passed; witnesses, repeatability, and baseline parity
  checked without timing assertions.
- Diff whitespace check: passed.
