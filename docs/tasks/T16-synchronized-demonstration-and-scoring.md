# T16 — Synchronized Demonstration and Scoring

## Status and goal

Complete following T15. The owner approved the interaction decisions
below. T16.1 is verified; T16.2 passed automated checks and its owner-reported
PC/phone checklist. T16.3 has automated verification and owner acceptance of the
basic Skip/Continue flow. T16.4 has automated verification and owner acceptance,
including all three result variants. T16.5 targeted reliability verification is
complete (1,346 workspace tests passed at that checkpoint). T16.6 automated
ten-round network scenarios pass; the owner confirmed all eight manual checks
working on 2026-11-01. Full workspace verification passed 1,349 tests, type checks,
production build and whitespace checks. Device evidence is owner-reported; no
specific iPhone Safari or hosted-performance claim follows.

Connect the existing demonstration, round-result and final-results UI to the
authoritative room. Distinct authenticated clients must see the same accepted
robot positions, active bidder, move count, scores and round/match transitions.
Reuse the existing pure rules and established UI rather than redesigning them.

Read `AGENTS.md`, `docs/product.md`, `docs/architecture.md`, `docs/plan.md`,
the T15.5 handoff, shared protocol README and the selected subtask before coding.
Implement one explicitly requested checkpoint at a time; writing tasks does not
authorize implementation, a commit, deployment or infrastructure changes.

## Ordered subtasks

- [x] [T16.1 — Authoritative attempts and round outcomes](T16-1-authoritative-attempts-and-round-outcomes.md)
- [x] [T16.2 — Connected demonstration controls](T16-2-connected-demonstration-controls.md)
- [x] [T16.3 — Round results and next-round progression](T16-3-round-results-and-next-round.md)
- [x] [T16.4 — Final results and return to lobby](T16-4-final-results-and-return-to-lobby.md)
- [x] [T16.5 — Retry, restart and permission verification](T16-5-retries-restarts-and-permission-verification.md)
- [x] [T16.6 — Full-match and device verification](T16-6-full-match-and-device-verification.md)

T16.1 must persist correct success/failure outcomes immediately: a first accepted
move can solve a target, and Give Up can exhaust the queue. Scoring cannot be a
temporary client operation or deferred until the result UI checkpoint.

## Approved interaction decisions

- Server-confirmed actions: tap, validate/persist on server, then display/animate
  accepted positions. No optimistic movement, local simulation or client scoring.
- One unresolved room mutation at a time in a client. Briefly disable movement,
  Undo, Reset and Give Up until the outcome and authoritative revision reconcile.
  Drop additional taps rather than queue them. A timeout permits an exact retry,
  not a fresh command ID for the same uncertain operation.
- Robot selection is immediate, local presentation state. Capture the selected
  robot in a directional request when sending; later selection cannot mutate it.
- **Give Up is immediate, with no confirmation dialog.** The owner explicitly
  declined confirmation for now. Reset also needs no new confirmation.
- Animate ordinary accepted moves for the active player and spectators. The owner
  subsequently approved Reset animating all robots directly back together, without
  replaying moves one by one. Bidder changes, reconnect/rebind and skipped attempt
  versions snap to current positions; never replay missed moves. Respect reduced motion and
  preserve existing single-step behavior where compatible with these boundaries.
- Do not use animation completion as game authority or require all spectators
  to acknowledge an animation before accepting another action.
- Explicit reconnect must recover the current authoritative attempt and disable
  writes until bound/synchronized. T17 still owns automatic recovery, liveness,
  host transfer and abandoned-bidder grace/skip. No unrestricted host skip-attempt.

## Fixed rules and safety boundaries

- Reuse pure `transitionMatch` and engine geometry/history/completion. Server
  identity/host/time and current phase/context authorize all accepted operations.
  Runtime-validated JSON is necessary but is not authorization.
- Only the frozen queue's active bidder can move, undo, reset or give up. New or
  revised bids are closed during demonstration. There is no demonstration timer.
- No-op directions cost zero moves. Undo/reset are free. Do not automatically
  fail at the bid limit: reject over-limit movement but keep corrections/Give Up.
- Success at or below the bid awards exactly one point and commits all four
  final positions. Give Up restores all four round-start positions before the
  next bidder; exhausted queues award nothing and keep official positions.
- Round Result is stable until host Continue. Rounds 1–9 advance into durable
  Preparing; round 10 enters Finished without an eleventh preparation. Host Skip
  Round is Thinking-only, no bids, with its existing confirmation (distinct from
  immediate Give Up). Do not add host early-close bidding or skip-demonstrator.
- New Match returns everyone to the lobby, not directly to round 1. Preserve room
  code, roster, host and valid existing identity; host can preview/shuffle/start.
- Extend versioned private persistence explicitly. Existing v1/v2/v3 data must
  remain readable or be migrated deliberately with tests; never wipe rooms.
  Validate private history/metadata and public consistency without rerunning a
  solver on restore. Proofs, credentials and move history remain private.
- Reuse existing request/reply/snapshot contracts and shared replay namespace.
  Exact retries are checked before stale phase/attempt preconditions, after
  membership/authentication; they return the retained outcome/current snapshot.
  Conflicting command-ID reuse and new stale actions must not mutate state.
- Attempt IDs identify attempts, versions identify their authoritative changes,
  and room revisions also cover unrelated connection updates. Do not use exact
  room-revision equality as the movement precondition, or reset attempt version
  to the retained move count after Undo/Reset.
- Preserve T15 preparation limits/recovery and earliest-due alarm scheduling.
  Continue queues work, not synchronous search. An unsuccessful preparation
  preserves gameplay state; no board swap, robot reset, target reuse or hidden skip.

## Design gates, not implicit new features

Before T16.1 implementation, describe storage extension, history validation,
attempt ID/version rules and contextual rejection mapping. Inspect whether current
snapshots can reliably distinguish ordinary moves from resets for spectators.
The owner reviewed the ambiguity and approved Reset using the same direct
position animation as normal moves. No animation metadata extension is needed.
Do not broadcast private history or introduce a new event stream unnecessarily.

Review history/storage costs under existing input/rate/replay protections. A new
gameplay bid/history limit, retention policy, external service or material wire
change needs explicit review; it is not authorized as a shortcut by this task.

## Completion and stop point

Automated tests and owner-guided checks cover a synchronized ten-round match,
corrections, queue rollover, atomic scoring/carry-forward, restart/retry and
return to lobby. Record actual commands/counts, warnings and device observations;
leave unavailable checks and preparation/resource limitations explicit.

T16 is not complete while a required verification gate is pending, unless the
owner explicitly accepts a documented limitation. Do not claim arbitrary
ten-round solvability, hosted performance, automatic mobile recovery or iPhone
Safari verification without evidence. Stop before T17 or deployment.
