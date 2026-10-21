# T09 — Solvability Validator Spike and Benchmark

## Status

Implemented and verified on 2026-10-21. The earlier cancellation was a
misunderstanding and has been withdrawn. Owner review of the measured budget
and fallback remains a gate before T10, not permission to start live selection.

## Goal

Implement a hidden, bounded solver in `packages/puzzles` that can prove a target
is reachable from the supplied current positions of all four robots. Benchmark
it on the five existing boards and representative carry-forward states before
deciding how to use it at live round boundaries.

The product requirement remains unchanged: reveal only targets verified solvable
from the current official positions. Checking initial positions alone does not
prove solvability after a successful round.

## Solver contract

- Accept a board, all four current robot positions, a target, and explicit
  finite search limits. Reject malformed inputs clearly; do not classify them
  as unsolvable.
- Return one of three distinguishable outcomes:
  - `solved`: a replayable sequence of robot/direction moves proving completion.
  - `unsolvable`: the reachable state space was exhausted without a solution.
  - `unknown`: a search limit prevented a conclusion, with the cutoff reason.
- Include deterministic search statistics, such as expanded, generated, and
  retained states. Bound both search work and retained states, not just depth.
- A target already satisfied at the start returns `solved` with an empty path.
  Whether round selection should exclude such targets is a T10 decision.
- Permit all four robots to move, including helper robots for colored targets.
  Preserve robot identity in state keys. Vortex targets accept any robot.
- Ignore no-op moves and count each legal slide as one move. Detect repeated
  states, use stable traversal order, and do not mutate the supplied state.
- A search cutoff is never evidence of impossibility. If depth is bounded,
  omitted deeper states must also result in `unknown`, not `unsolvable`.
- Finding any valid solution is sufficient; optimality is not a product
  requirement.

## Implementation steps

1. Define the solver inputs, limits, result union, and statistics. Reuse engine
   types, validation, movement, and target-completion rules.
2. Implement a deterministic bounded baseline search with visited-state
   tracking and memory-conscious path reconstruction.
3. Add correctness tests and replay every solved fixture through the existing
   engine to verify its witness independently of the search implementation.
4. Add a reproducible benchmark entry point separate from normal unit tests
   and the web application. Measure the baseline before optimizing.
5. If measurements justify indexed geometry or another optimized transition
   implementation, compare it against engine movement with differential tests.
6. Record results and recommend search limits and fallback behavior for owner
   review. Do not implement live target selection in this task.

## Correctness tests

- Known one-move and multi-move solutions, including the starter board's known
  blue-star solution.
- A solution requiring a helper robot, all four colored target requirements,
  and wildcard completion.
- Already-complete targets and a small, provably unsolvable fixture.
- Work and storage limits, plus depth limits if supported; cutoff results must
  remain distinct from exhaustive failure.
- Walls, blocked cells, robot collisions, no-op inputs, and repeated states.
- Input validation, immutability, deterministic results, and identity-preserving
  state encoding.
- Solving from legally obtained carry-forward positions rather than silently
  reverting to the board's initial positions.

## Benchmark coverage and report

Provide a documented package command, for example
`pnpm --filter @robot-puzzle/puzzles benchmark:solver`, and record findings in
`docs/benchmarks/T09-solvability.md`.

Cover all 17 targets from initial positions on each of the five boards (85
cases). Also include at least one reproducible, legally replayed carry-forward
position set per board, testing both colored and wildcard targets. Include
known-solvable, provably-unsolvable, and deliberately budget-limited fixtures.
Replay every reported solution through the existing engine.

Record the runtime and machine, source revision, exact limits, fixture setup,
warm-up/repetition method, elapsed times, outcomes, solution lengths, expanded
and generated states, and peak retained states. Distinguish observed memory
measurements from estimates. Include unknown and unsuccessful cases in the
report rather than reporting only successful timings.

Local Node timings are not proof of Cloudflare runtime feasibility. If the
baseline is too slow or leaves many targets unverified, report that explicitly;
do not claim guaranteed catalog coverage or instantaneous live validation.

## Boundaries and review gate

Keep the solver pure, deterministic TypeScript: no React, browser APIs,
networking, randomness, or timers in the search core. Measure wall-clock time
outside the core. A timer cannot interrupt synchronous search; deterministic
work/storage limits must actually bound the search.

Do not change board designs, demonstration controls, game rules, or existing
movement behavior. Do not expose solutions or hints to players. Target
selection, proof-cache integration, and round setup belong to T10; match and
multiplayer behavior remain later tasks.

Recommend a measured budget and a fallback that distinguishes one unverified
candidate from having no verified unused candidate. Considering another unused
target or reusing a proof is safe only when that proof applies to the exact
board, target, and all four current positions. Do not silently reveal an
unverified target, reset robots, replace the board, repeat targets, or shorten
the match.

**Do not proceed to live round generation until the owner approves the budget
and fallback.** T09 delivers the implementation, tests, benchmark evidence, and
recommendation; it does not assume that approval.

## Verification

Run focused puzzles tests and type checks, the benchmark, then workspace tests,
type checking, the production build, and `git diff --check`. Record actual
results and any blockers before marking the task complete.

## Completion evidence

- `@robot-puzzle/puzzles/solver` exposes bounded deterministic BFS with validated
  inputs, replayable solutions, exhaustive failure, and explicit unknown cutoffs.
  Indexed movement is differential-tested against the unchanged engine.
- All 85 initial cases and 85 carry-forward cases were benchmarked. The normal
  50,000-expansion cap solved 168; the other two were verified by separately
  measured larger-budget searches, not mislabeled as unsolvable.
- Puzzles tests: 74 passed (45 new). Workspace tests: 185 passed. Type checks,
  production build, standalone benchmark, and whitespace checks passed.
- See `docs/benchmarks/T09-solvability.md` and its generated JSON evidence for
  exact limits, machine/runtime, timings, memory caveats, and fallback proposal.
- No game-rule, board, demonstration, or live round-selection changes. Arbitrary
  future carry-forward states and Cloudflare performance remain unproven.
