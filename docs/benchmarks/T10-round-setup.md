# T10 — Complete round-setup measurements

## Result and reproduction

The pure selector passed 22 measured scenarios: 16 selected a verified target,
three deferred selection, and three returned an explicit unavailable result.
Selection includes catalog/current-state validation, filtering, bounded solver
calls, independent engine replay, diagnostics, and round-start snapshots.

```powershell
pnpm --filter @robot-puzzle/puzzles benchmark:round-setup
```

The command regenerates [raw evidence](T10-round-setup-results.json) and leaves
the historical T09 benchmark files unchanged. Exact inputs, budgets, all four
positions, candidate order, used targets, results, proofs, diagnostics, and
individual samples are recorded. The unit tests remain separate from timings.

## Environment and method

- Measured 2026-10-21 at 19:54:17 UTC; Node v20.19.4, Vitest 3.2.7.
- Windows x64, release 10.0.26200; AMD Ryzen 7 8845HS, 16 logical CPUs.
- Base revision `97f35706ecd9aacf172e6bf34540feed95d39199`, with uncommitted T10
  changes. The metadata lists all fingerprinted implementation/harness files.
- LF-normalized source SHA-256:
  `98e8a27e6e2304b5c0eef9f32ff5de2e5f8f6753545f11c216b65640cd6cd1ef`.
- Serialized catalog SHA-256:
  `64b1c53223d5e55ed6c828a86651b95b61c3f4f4d281aa9baa431d09ac5cedf4`.
- One warm-up plus three measured serial calls per scenario (66 timed calls).
  Timings include the complete public `prepareNextRound` operation. Independent
  post-call verification and fixture preparation are outside the timed region.
- Every result is checked for deterministic equality and aggregate/per-candidate
  budget compliance. Every selected proof is independently replayed again by
  the harness. No timing assertions, random fixture generation, or forced GC.
- Memory snapshots are process observations after calls, not incremental or
  per-call peak measurements; GC, Vitest, JIT, and preceding searches contribute.

## Outcomes

Recommended policy: 50,000 expansions / 150,000 stored states per candidate,
200,000 total actual expansions per invocation. Search candidates sequentially.
Across all scenarios, including unsuccessful results, nearest-rank median / p95 /
maximum timings were **2.75 / 67.41 / 103.11 ms**. These are local measurements,
not server-runtime deadlines or guarantees.

Each catalog board contributes three cases: initial positions in authored target
order, positions after the first selected proof with its target now used, and
initial positions with reversed candidate order. Reversal is a deterministic
order fixture, not a random shuffle. Initial calls selected red star; carry-forward
calls selected red crescent; reversed order selected the vortex.

| Board | Initial ms range | Carry-forward ms range | Reversed order ms range |
| --- | ---: | ---: | ---: |
| Starter Board | 1.78–3.43 | 1.15–1.66 | 2.05–4.09 |
| Crossroads | 10.16–19.87 | 5.41–8.04 | 0.88–0.93 |
| Switchback | 2.86–3.85 | 15.86–17.10 | 1.04–1.38 |
| Pinwheel | 0.84–0.91 | 3.14–3.87 | 1.75–1.85 |
| Constellation | 22.09–27.68 | 9.21–10.55 | 0.90–1.32 |

Carry-forward input positions are the legally replayed final positions of the
first selected solution. Returned round-start positions equal those inputs,
not board starts or the next solver proof's final positions. All selected proofs
contain at least one move. Used and already-complete targets remain ineligible.

Additional cases:

| Scenario | Result | Actual expansions | Measured ms range |
| --- | --- | ---: | ---: |
| Constellation yellow crescent first, then alternatives | Selected red star after unknown crescent | 67,457 | 89.59–103.11 |
| Only Constellation yellow crescent unused | Deferred: unverified candidates | 50,000 | 66.16–67.41 |
| Starter with total allowance 8, per-candidate allowance 5 | Deferred: total limit; 15 untested | 8 | 0.61–0.66 |
| Starter with retained-state allowance 1 | Deferred: all 17 candidates unknown | 17 | 2.28–2.98 |
| Isolated-robot test board | Unavailable: all eligible targets proven unreachable | 17 | 2.90–5.64 |
| Starter, every target used | Unavailable: all used | 0 | 0.40–0.52 |
| Starter, sole unused target already complete | Unavailable: already complete | 0 | 0.40–0.61 |

The isolated-robot board is a catalog-valid test fixture with eight extra walls
enclosing the four starting corners. It is not registered as a playable board.
Each target search exhausts a single immobile state, including when the aggregate
budget ends exactly after the final exhaustive result.

The hard-first Constellation case spends 50,000 expansions on an inconclusive
candidate, then 17,457 on a verified alternative. The small aggregate-cap case
passes allowances of 5 then 3 to consecutive searches, establishing that the
remaining budget is reduced rather than reset. The retained-state case examines
all 17 candidates once and terminates with no proof; it does not claim they are
unreachable. No result changes official state or used-target tracking.

## Interpretation and remaining integration decisions

The normal budget permits useful alternate-target selection for these fixtures.
The roughly 100 ms hard-first case shows that complete selection cost includes
unsuccessful work, not just the successful target's solve time. The 200,000 total
limit bounds actual expansion work, but these scenarios do not exercise a complete
200,000-expansion invocation or establish its worst-case latency. Memory caps
apply per search; process-wide memory across allocations and concurrent rooms
still requires profiling in the actual server runtime.

The implemented immediate fallback is to try another candidate within the same
budget. If selection remains inconclusive, return a deferred result and keep the
target unrevealed; preserve board, robots, score, round count, and used IDs.
When every eligible target is exhaustively unreachable, return an unavailable
result rather than relabeling it as a temporary search timeout.

Live recovery scheduling, retries, and feedback are not implemented by this
pure function. They must be decided before wiring deferred/unavailable results
into a live match. Initial and sampled carry-forward success does not guarantee
that every possible official position has enough unused reachable targets to
finish ten rounds. No automatic larger-budget retry, proof cache, UI, match
state machine, or multiplayer integration was added.
