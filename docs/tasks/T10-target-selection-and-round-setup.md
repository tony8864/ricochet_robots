# T10 — Target Selection and Round Setup

## Status

Implemented for the pure T10 scope at the owner's request. The request approved
the documented budgets, already-complete target exclusion, and immediate bounded
alternate-target fallback. Live recovery scheduling/feedback and server-runtime
profiling remain decisions before multiplayer integration; they are not silently
resolved by returning a deferred result.

## Goal

Prepare the next round by selecting an unused target from the locked board that
is verified solvable from all four current official robot positions. Capture
those exact positions as the next round's starting positions.

Keep the selection logic pure and independently testable in `packages/puzzles`.
T11 will own match transitions and committing a prepared round; T12 will own the
corresponding screens. Multiplayer authority remains with the future server.

## Existing behavior and dependencies

- Five full boards are registered in `packages/puzzles/src/catalog.ts`, each
  with 17 fixed targets and legal initial robot positions.
- T09 provides `solvePuzzle` through `@robot-puzzle/puzzles/solver`, with
  `solved`, `unsolvable`, and `unknown` results and deterministic statistics.
- `unsolvable` means exhaustive search; `unknown` means a search limit prevented
  a conclusion. These outcomes must remain distinct during selection.
- Successful rounds carry forward all four final robot positions. Initial-board
  proofs cannot establish solvability from different carry-forward positions.
- See `docs/benchmarks/T09-solvability.md` for measured budgets and limitations.

## Selection policy

1. Validate the selected board entry, current positions, used target IDs,
   supplied candidate order, and search budgets.
2. Exclude previously revealed targets. A target remains used after a failed or
   skipped round, not only after a successful one.
3. Exclude targets already complete at the current positions: a colored target
   occupied by its matching robot, or a vortex occupied by any robot. A different
   colored robot on a target does not make that target already complete.
4. Examine eligible targets in the supplied order. The caller supplies a shuffled
   order for variety; tests supply a deterministic order. Do not call
   `Math.random`, read clocks, or generate randomness inside the selector.
5. Run the bounded solver for a candidate using the current positions. On
   `unknown` or `unsolvable`, consider the next candidate while budget remains.
6. For the first verified solution, independently replay its moves with engine
   movement and check target completion, then return a prepared round and
   internal proof. A failed replay is an internal error, not a valid selection.
7. If selection cannot finish, return an explicit result describing the reason.
   Preserve all official state and leave the next target unrevealed.

Targets excluded because they are already complete, proven unreachable, or
unverified are not marked used. They may be reconsidered after positions change;
unverified targets may also be retried with a separately supplied bounded budget.
Examine each eligible candidate at most once per invocation.

Shuffling followed by selecting the first candidate verified within budget does
not promise uniform sampling of all solvable targets or a difficulty ranking.
Do not add difficulty scoring or choose by the shortest solution in this task.

## Budgets

Keep limits explicit and validated, with one documented policy configuration:

- Per candidate: at most 50,000 expanded states and 150,000 retained states.
- Per selection invocation: at most 200,000 actual expanded states across all
  candidate searches, with at most the finite number of eligible candidates.
- Before each call, cap its expansion allowance at the smaller of the per-target
  allowance and remaining aggregate allowance. Debit the actual expansions
  reported by the solver, including work on unknown or unsolvable candidates.
- Stop when the aggregate allowance is exhausted; never give every remaining
  target a fresh aggregate budget. A zero-expansion allowance must not initiate
  a search for an eligible, non-complete target.
- Search candidates sequentially. The per-search retained-state cap does not
  establish a process-wide memory guarantee across calls and garbage collection.

These are work/storage limits, not a millisecond timeout. T09's larger
200,000-expansion / 500,000-state diagnostics are not an automatic retry policy.
Production limits still require measurements in the actual server runtime.

## Inputs and results

Use existing engine and puzzle types rather than introducing another board or
robot representation. The public function names and exact union tags may follow
package conventions; the contract must include:

- Inputs: a validated full-board entry, all four current official robot
  positions, used target IDs, an explicit candidate ordering, and finite budgets.
- The ordering must contain every board target exactly once. Reject duplicate,
  missing, or unknown candidate IDs rather than silently omitting candidates.
  Reject used target IDs that do not belong to the selected board.
- Selected result: target identity/data, a snapshot of all four round-start
  positions, an internal solution proof, and bounded-search diagnostics.
- Unsuccessful result: a reason distinguishing all targets already used,
  otherwise unused targets already complete, all eligible targets proven
  unreachable, and inconclusive validation/search-budget exhaustion. Mixed
  unknown and untested candidates must not be classified as unreachable.
- Diagnostics: candidates examined, per-candidate outcome and search statistics,
  aggregate expansions, and counts of filtered or untested targets sufficient
  to explain why selection stopped. Do not retain every failed search frontier.
- Malformed inputs produce clear validation errors, not an unavailable-puzzle
  result. No input data is mutated.

Returning a prepared round does not itself reveal a target, increment the round,
award points, or change the used-target set. T11 must atomically record the
selected ID as used when it starts/reveals that round. Pass that updated set into
subsequent selection calls to prevent repeats.

Solution proofs are internal data. Keep them separate from any future public
room snapshot; do not expose them through player controls or hints.

## Fallback and recovery decision

The proposed immediate fallback is to try another eligible unused target within
the aggregate budget. If no target is verified, return to the caller with an
explicit failure/deferred result and no prepared round.

The owner still needs to choose how an actual match recovers from that result.
The T09 proposal is to preserve the official state and use a separately bounded
background/offline validation pass while the next target remains unrevealed.
Its scheduling, retry limits, runtime placement, and player feedback are not yet
agreed. A pure deferred result alone is not an implemented recovery system.

Record the agreed recovery policy before wiring selection into live rounds. Do
not implement an unbounded retry loop, claim ten-round continuation is guaranteed,
or conceal failure by revealing an unverified target, resetting robots, changing
boards, repeating a target, or counting an unrevealed round as skipped.

## Implementation steps and likely files

1. Define selection input, result, diagnostic, and budget types in a focused
   module under `packages/puzzles/src/roundSetup/` (or an equivalent small module).
2. Add boundary validation and candidate filtering/order handling.
3. Implement budget accounting and the sequential solver loop, including witness
   replay and round-start position snapshots.
4. Implement explicit unsuccessful results and preserve the reveal/commit
   boundary for the later match state machine.
5. Add focused unit tests and real-solver integration tests using deterministic
   fixtures and carry-forward states.
6. Expose the API through a separate package subpath, following the solver
   convention, so catalog-only consumers do not import selection/search code.
7. Document the API and agreed policy in `packages/puzzles/README.md`; link this
   task from `docs/plan.md`. Update product or architecture documents only for
   explicitly approved decisions that belong there.
8. Measure representative complete selection calls, including searches that hit
   limits, to assess the aggregate policy. Record findings separately without
   overwriting the historical T09 results unnecessarily.

Prefer existing dependencies and engine validation/completion/movement helpers.
A small internal solver seam may support deterministic budget tests; production
must use the T09 solver, and real-solver tests must exercise the complete path.
Proof caching and changes to the search algorithm are not required for this
first selector.

## Acceptance tests

- Only targets belonging to the selected board can be returned.
- Used targets are never selected. A selected target passed back as used cannot
  repeat, including when the previous round was failed or skipped.
- Already-complete colored and wildcard targets are filtered correctly and
  remain unused; another color occupying a colored target does not filter it.
- Every selected target has a non-empty, legally replayable solution from the
  supplied current positions, with helper robots allowed.
- A carry-forward fixture changes multiple robots; selection and the returned
  snapshot use all current positions rather than board starts or solver-final
  positions.
- Supplied ordering is respected, and identical inputs give identical results.
- Unknown and unreachable candidates can be followed by a verified candidate.
- Per-candidate and aggregate work/storage caps hold, including a reduced final
  allowance and budget spent on unsuccessful searches.
- Empty eligibility, all-used, all-complete, exhaustive failure, mixed unknown
  outcomes, and untested candidates return the correct unsuccessful results.
- Invalid board/state, IDs/order, and budgets fail clearly. Inputs remain
  unchanged on every outcome; round setup never marks a target used itself.
- Focused integration fixtures use the real T09 solver and independently replay
  selected proofs. Budget accounting tests can use controlled outcomes without
  real-time sleeps or timing assertions.

## Boundaries and verification

Keep this task in the pure puzzles layer. Match progression, scoring, bidding,
host skip, and committing official state belong to T11 and later server tasks.
Round UI belongs to T12. Leave board data, demonstration controls, rendering,
and movement rules unchanged. Do not add new infrastructure or background jobs
as an implicit part of this task.

Run puzzles tests/type checks, representative selection measurements, then
workspace tests, type checking, the web production build, and `git diff --check`.
Document actual results and unresolved recovery/runtime limitations before
marking T10 complete. Do not claim that bounded selection ensures every possible
match can finish ten rounds.

## Completion evidence

- `@robot-puzzle/puzzles/round-setup` exposes `prepareNextRound`, required explicit
  budgets, copied round-start/target data, separate internal proofs, and detailed
  bounded-search diagnostics. Used targets are committed later on reveal.
- Invalid inputs fail clearly; unused already-complete targets are excluded;
  unknown, untested, all-used, all-complete, and exhaustive-failure results remain
  distinguishable. Work on unsuccessful candidates reduces the total allowance.
- Fifty new tests cover the selector, budget handling, replay, carry-forward
  positions, immutable inputs, and a real exhaustive unreachable fixture.
- Complete-call measurements cover 22 deterministic scenarios. See
  `docs/benchmarks/T10-round-setup.md` and its generated JSON evidence.
- All 235 workspace tests, workspace type checks (including the measurement
  harness), the web production build, and whitespace checks passed.
- Existing board definitions, movement, demonstration controls, and T09 benchmark
  evidence are unchanged. No new dependencies or live retry system were added.
