# T11.2 — Match Creation and Verified Round Preparation

## Status

Implemented on 2026-10-24. This retrospective task file records the existing
implementation; it does not request additional behavior. T11.3 adds the following
bidding/deadline path; see the parent checklist for current remaining work.

Read the [parent T11 task](T11-pure-match-state-machine.md),
[state design](T11-1-state-and-transition-design.md), `docs/product.md`, and
`docs/architecture.md`. Preserve the approved rules and pure package boundaries.

## Goal and transition

Create a valid match and connect the T10 selector to its first active round:

```text
createMatch -> PREPARING -> verified target accepted -> THINKING
                   |
                   +-> deferred/unavailable -> stay PREPARING
```

The same preparation path must use current official positions for later rounds.
No bid, timer, attempt, point award, or round-result advancement belongs here.

## Implemented responsibilities

- `createMatch` validates a nonempty supplied match ID, 2–6 distinct nonempty
  seat IDs, nonempty nicknames, and complete valid board data. Nicknames may be
  duplicated; seats identify players.
- Copy known roster/board fields into owned data, initialize scores to zero and
  positions to the catalog starts, and return Preparing with no used targets or
  completed rounds. Creation runs no target search and creates no random ID.
- `prepareMatchRound` accepts caller-supplied candidate order and explicit budget.
  Reject non-Preparing/finished states without solver work; guard preparation
  round-count consistency before invoking T10.
- Capture match ID, completed-round count, board definition, current positions,
  used IDs, order, and budget in an independent internal request snapshot.
- Call T10 exactly once per explicit preparation attempt. Do not duplicate its
  selection policy or automatically retry/deepen the search.
- Reject stale request context, wrong-board/foreign/used/already-complete targets,
  incorrect start snapshots, and invalid proof moves. Replay the proof through
  engine movement before acceptance.
- Atomically enter Thinking with the target marked used and a copy of all current
  positions as `round.startRobots`. Round number is `completedRounds + 1`.
- Keep scores, official positions, completed-round count, roster, and board
  unchanged. The solver's final positions do not become official positions.
- Deferred/unavailable preparation is an accepted controller operation that
  remains Preparing with reason/diagnostics. Reveal no target and consume no
  round. A later retry is another explicit call.
- Store no solution proof in ordinary match state. Internal snapshot/acceptance
  helpers and the controlled-preparer test seam are not public package exports.

## Files and API

- `packages/match/src/create.ts`: public `createMatch`.
- `packages/match/src/preparation.ts`: public `prepareMatchRound` plus internal
  snapshot, acceptance, proof checking, and test-seam functions.
- `packages/match/src/data.ts`: copies and comparisons for known domain data.
- `packages/match/src/commands.ts`: `RoundPreparationOptions` and request types.
- `packages/match/src/create.test.ts`, `preparation.test.ts`, and `model.test.ts`.
- `packages/match/README.md`: runnable creation/preparation usage example.

Invalid creation/options fail clearly with `TypeError` or `RangeError` as
documented. Invalid/stale acceptance returns a rejected transition preserving
state. These operations assume trusted internal controller use; they do not
authenticate network clients or validate arbitrary restored match state.

## Acceptance and recorded verification

- Creation accepts 2–6 players and rejects malformed identities, duplicate seats,
  invalid boards/targets/starts, and invalid roster sizes.
- All five real catalog boards have a tested Preparing → Thinking path.
- A legally replayed fixture changes multiple robots; next preparation uses all
  carried positions and preserves prior scores/used targets.
- Failed preparation preserves official state; explicit retry can start round 1.
- Stale match/round/geometry/position/used-ID snapshots, malformed selected data,
  invalid witnesses, already-used/completed targets, and repeated acceptance fail.
- Frozen-input, independent-copy, proof-removal, and deterministic-result checks
  pass. An actual exhaustive T10 failure remains distinct from a search cutoff.
- Verification recorded on implementation: 57 new runtime tests; 64 match-package
  tests including the seven T11.1 contract checks; all 299 workspace tests, type
  checks, production build, and whitespace checks passed.

Those are historical results, not a claim that checks were rerun while writing
this task file. No further code change is needed to document this completed step.

## Boundaries

Live recovery scheduling/feedback, background validation, network authority,
bidding, movement controls, scoring, and round advancement are outside T11.2.
Do not claim full-match readiness or guaranteed ten-round continuation from these
preparation tests. Continue with T11.3 only when explicitly requested.
