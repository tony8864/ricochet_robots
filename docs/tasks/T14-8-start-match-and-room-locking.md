# T14.8 — Start Match and Room Locking

## Status and goal

Implemented; owner PC/Android Start, late-join rejection, existing-seat rejoin and
backend restart checks passed. See [T14.9](T14-9-final-verification.md) for the final
evidence and disconnect limitations. Follows
[T14.7](T14-7-connected-lobby-ui.md) in
[T14](T14-room-creation-seats-and-invite-flow.md).

Connect the host's Start Match button to the authoritative room. Starting commits
one match, locks the current board and roster, and takes all connected clients
into Preparing. New players cannot join afterward; existing authenticated members
can still resume their original seats.

This checkpoint does **not** run the solver, reveal a target, enter Thinking,
start a timer or enable a playable networked match. T15 owns live preparation and
bidding. Preparing deliberately remains stable until that later integration.

Read `AGENTS.md`, `docs/product.md`, `docs/architecture.md`,
`packages/shared/README.md`, the approved T13.1 protocol and T14.7 before coding.
Inspect current room persistence, replay accounting and event serialization first.
Implement this checkpoint only; creating this task does not authorize code changes.

## Established rules and boundaries

- Only the currently authenticated host can start, from the current Lobby.
- Require 2–6 **seated players**. Do not silently require every seat to be online,
  remove disconnected seats or introduce a ready check. Connection status and
  membership remain separate; no new host-transfer/disconnect policy is added.
- Use the existing validated `room.start` request: room ID, command ID,
  `{ lobbyId }` context and `{ type: 'room.start', boardId }` command.
  The server selects identity, match ID, roster, geometry and initial positions.
- Start the currently previewed board, not a new shuffle. Reject a mismatched
  board ID as `preview-changed` and an old lobby as `stale-context`.
  Do not impose exact room-revision equality: an ordinary join/connection update
  need not invalidate a valid Start request.
- Preserve ten rounds, all existing game rules, private session mappings,
  duplicate nicknames and the fixed 24-hour identity lifetime.
- Use existing messages, rejection reasons and public projection. No new endpoint,
  wire field, client-controlled match state or external dependency is needed.
- Keep the local simulator working separately. Do not change board rendering,
  engine movement or local Start behavior.

## Ordered implementation checkpoints

### T14.8.1 — Authoritative Start transition and persistence

1. Extend the existing authenticated socket-command path to accept `room.start`.
   Keep Origin/session/membership, raw-size, rate and replay-capacity protections.
   Authorize against current durable room state, not client host/seat claims.
2. Reuse the Room's existing serialized event path for membership and commands.
   Validate phase, host, lobby context, selected board and roster size before
   accepting a new Start. Use the existing public rejection vocabulary:
   `wrong-phase`, `not-host`, `stale-context`, `preview-changed`,
   `not-enough-players`, and `command-id-conflict` as applicable.
3. Create one server-generated match ID and call the pure `createMatch` API with
   the durable roster and selected catalog board. Initial scores are zero,
   completed rounds are zero, used targets are empty and official robots equal
   that board's valid initial positions. Pure creation must not search for a target.
4. Persist the private match state required by T15, its public projection, the
   Start replay outcome and the resulting monotonic revision in one Room storage
   transaction. Publish/acknowledge only after commit. Match creation must not
   reset membership, room ID/code, host, connection metadata or the replay ledger.
5. Choose the smallest compatible versioned extension to current persistence.
   Existing lobby records without a match must still load; do not wipe local
   storage or rewrite private credentials. Check restored internal/public state
   consistency and fail closed on corrupt/unsupported records rather than silently
   recreating a match or resetting positions. Record the storage choice in the
   implementation notes/architecture documentation.
6. Project accepted state as `status: 'playing'`, phase `preparing`, using the
   existing allowlist projector. The existing not-attempted preparation maps to
   public `working`; that mapping is not proof that solver work is scheduled.
   Do not broadcast private credentials, undo/solver data or internal bookkeeping.
7. Retain the existing session-expiry alarm behavior. This task adds no round or
   solver scheduling and must not replace that alarm with an unrelated timer.

**Check:** a real authenticated Start changes a valid lobby into one persisted
Preparing match and broadcasts the same state to its connected members.

### T14.8.2 — Locking, retries and ordering

1. Use the same room/session command-ID namespace as membership and Shuffle.
   An exact retry returns its original outcome plus the current snapshot, even
   after the room leaves Lobby. It must not create a second match, reset scores,
   change the selected board or rerun initialization. Conflicting ID reuse rejects
   without replacing the retained record.
2. Verify the existing join/resume policy against a room started through the real
   command, not only seeded playing fixtures: new identities get `match-started`;
   an existing member retains its seat/name through code-based rejoin, explicit
   resume and WSS binding. A nickname alone cannot reclaim another seat.
3. Reject new Shuffle and new Start requests after starting. Preserve read-only
   state requests, broadcasts, connection reconciliation and explicit reconnect.
   A late retry of an already processed command follows its original replay
   outcome rather than executing again in the new phase.
4. Test serialized races deterministically: a join processed first belongs to the
   locked roster; a new join processed after Start is rejected. A shuffle processed
   before Start can cause `preview-changed`; a shuffle after Start cannot alter the
   locked board. Do not invent cross-object transactions or timing sleeps.

**Check:** duplicate/late requests and restart cannot unlock the room, add a new
seat or replace the accepted match.

### T14.8.3 — Start button and connected Preparing view

1. Enable Start only for the current host, once connected/bound, in Lobby with at
   least two seats and no unresolved competing room mutation. The server remains
   authoritative even when the client disables the button.
2. Send the board ID and lobby ID from the latest validated snapshot. Serialize
   Start and Shuffle in the client so rapid clicks cannot issue competing local
   mutations. Show pending feedback and safe inline rejection/connection errors;
   never transition optimistically or fall back to the local match controller.
3. Preserve the original Start ID/payload for a lost reply and explicit retry.
   Reconcile acknowledgments with current snapshots/revisions. After a playing
   snapshot arrives, do not re-enable a fresh Start, even if its acknowledgment
   is delayed. Reconnect can recover the original outcome without a new identity
   or match. Generalize the existing lobby adapter only as much as needed.
4. When the authoritative snapshot enters Preparing, replace lobby-only controls
   with a read-only Preparing presentation for both host and guests. Retain the
   board, locked roster, room-code copy control and connection feedback where
   practical; keep the code at the top-right above the board.
5. Explain the checkpoint honestly, for example: "Match started. First-target
   preparation will be connected next." No revealed/active target, bid controls,
   movement controls, client countdown, automatic continuation or preparation
   Retry button that has no server implementation. Reuse presentation where
   appropriate, not the local controller or local preparation callbacks.

**Check:** PC and phone both enter the same read-only Preparing view after the
host starts. Guests have no Start/Shuffle; neither device can move robots.

### T14.8.4 — Verification and handoff

- Unit/runtime tests: host-only permission, one-player rejection, valid two-/six-
  player start, stale lobby, changed board, immutable initial data and no solver
  call. Assert room identity/roster, board, scores, target supply and robot starts.
- Real Worker/WSS integration: matching snapshots on both clients, private result
  isolation, exact duplicate Start, conflicting reuse, rejected post-start actions,
  new-join lock and existing-seat resume. Include deterministic race ordering and
  transaction failure/retry without partially committed match/public/replay state.
- Full runtime shutdown/recreation: Preparing match ID, locked board/roster,
  official robots, zero scores, revisions, memberships and Start replay survive.
  Rebind returns the same match; a new identity is still denied entry.
- Client tests: eligibility/pending/error states, Start-vs-Shuffle serialization,
  lost acknowledgments, exact retry after reconnect, stale snapshots and late
  socket callbacks, guest view and stable Preparing with no local preparation.
- Keep existing local simulator/board/code-copy tests passing. Run relevant tests,
  full workspace tests/type checks, production build and whitespace checks.
  Record counts, commands, warnings and failures; do not hide runtime warnings.
- Manual PC + Android check using the existing separately approved HTTPS setup:
  join with two identities, start as host, verify the same Preparing board/roster,
  try a third identity and resume an existing one. Document what was actually
  observed. No certificate, firewall, permission, hosting or deployment changes
  without separate approval. Browser emulation is not physical-device evidence.

## Likely files

- `apps/server/src/liveLobby.ts`, `lobbyCommands.ts`, `roomMembership.ts`,
  `room.ts` and the smallest storage extension needed for private match state.
- `apps/server/package.json` for a direct existing `@robot-puzzle/match` workspace
  dependency if needed; no new external library.
- Focused server command/membership/socket and restart/persistence tests.
- `apps/web/src/lobby/liveLobbyClient.ts`, connected lobby/preparation presentation
  and existing shared lobby actions, plus focused tests/scoped styling if needed.
- Task, development and architecture notes reflecting the implemented boundary.

These are responsibility hints, not permission for a broad refactor.

## Completion and stop point

Host Start creates exactly one durable Preparing match from the current lobby,
all clients see the authoritative transition, new joins are locked out and existing
seats can reconnect. Tests and actual manual evidence/limitations are recorded.

Stop before target preparation, bidding, gameplay, automatic reconnect, room/host
expiry policy, T14.9 or T15. Do not mark all T14 complete from this checkpoint.
No commit, deployment or additional implementation task without a separate request.

## Implementation record — 2026-10-29

- Existing authenticated Room sockets now accept `room.start` with host/lobby/
  selected-board/2–6-seat checks. `createMatch` runs only for a new accepted Start;
  no target selector/solver is invoked. Initial match/public state and replay result
  commit in the same existing SQLite transaction. No session-expiry alarm changed.
- The durable room JSON now optionally includes `match: { version: 1, state }`.
  Existing lobby rows remain valid without that field; no table/schema reset or
  migration is required. `storedMatch.ts` verifies exact private initial-Preparing
  shape and agreement with its public projection. Unsupported versions/phases,
  missing match records and inconsistent data fail closed, never reconstruct or
  overwrite a match. T15 must explicitly extend this codec for later lifecycle
  phases; version 1 currently supports initial not-attempted Preparing only.
- Match storage is private, not part of any public snapshot. Membership/resume,
  connection reconciliation and creation replays now validate stored match/public
  consistency. Existing test-only locked fixtures were replaced with real Start
  transitions. The server declares the existing match workspace as a direct
  dependency; no external library was added.
- The client has one shared pending Start/Shuffle slot, immutable exact retries,
  result/snapshot correlation and safe errors. A playing snapshot enters Preparing
  immediately without authorizing another Start. A lost result can be recovered
  through explicit reconnect and exact retry even from Preparing.
- Shared lobby presentation now also renders a read-only Preparing board/roster,
  top-right room code/Copy and connection status. No active target, local match
  controller, preparation Retry, game controls or implicit continuation is used.
- Tests cover two-/six-player starts, offline seated members, permissions/context,
  board changes, no solver call, exact replay/ID conflicts, rollback when replay
  insertion fails, corrupted storage, two-client WSS snapshots, late-join locking,
  existing membership/rebind, ordered join/shuffle/Start, and full runtime restart.
  Client tests cover eligibility, mutation serialization, errors, lost result/
  reconnect replay and Preparing presentation.
- Full workspace tests: **1,152 passed** (223 web, 133 server including 3 restart
  tests, 796 engine/puzzle/match/shared). The runner emitted known IoContext
  cancellation/Windows EBUSY temporary-cleanup warnings, with no failed assertions.
  The initial corrupt-position test used an unchanged coordinate; corrected its
  fixture to ensure a real mismatch. A socket test helper type was also corrected.
  Final workspace type checks, production web build and whitespace checks passed.
  Commands: `pnpm test`, `pnpm typecheck`, `pnpm build`, `git diff --check`.
- No manual PC/Android Start check or browser emulation is claimed. Chrome access
  was denied during prior UI verification; no permission/trust changes were made
  or attempted here. Physical-device review remains with the owner.

### Owner smoke test

1. Restart the backend if it has not reloaded; refresh the frontend on both devices
   so they use the new code. This UI still has no full-page reload seat recovery.
2. Create a fresh room on PC and join from the phone. With only one seat, Start is
   disabled; with two seated players, the connected host can press Start Match.
3. Both devices should show Preparing match, the same read-only board and locked
   roster. No target is active. Staying here is expected until T15, not a stuck
   solver or a timer waiting to expire.
4. Try joining the room from a third isolated identity: expect match-started
   feedback. Rejoining in an existing browser identity should keep its seat/name
   and open Preparing. Ordinary tabs share identity and do not test new-player lock.
5. Verify Shuffle/Start are absent during Preparing and robot controls are absent.
   Record device results before the broader T14.9 verification checkpoint.
