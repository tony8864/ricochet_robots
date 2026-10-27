# T13.3 — Public Snapshots and Safe Projection

## Status and dependency

Definition reviewed and implementation authorized on 2026-10-26 after T13.2.
The owner approved proceeding with the three review clarifications recorded below.
Follow the [parent](T13-typed-protocol-and-validation.md) and reviewed T13.1 design.
Implement public room/match data, not persistence or a room state machine.

## Work

1. Define the reviewed lobby and in-match snapshot variants, room/match identity,
   host and public roster, selected board representation, and revision fields.
   Lobby allows 1–6 seats; a started match has its fixed 2–6-player roster.
2. Represent all six match phases with only their applicable public fields.
   Supply enough data for T12's read-only board, bids/countdown, active attempt,
   round outcome, and final results without making React another authority.
3. Build pure explicit projection helpers from known match/public-room inputs.
   Select allowed fields at every nested boundary. Do not spread arbitrary room
   objects or blindly JSON-serialize `MatchState` as the public wire contract.
   Reuse match-derived data/selectors rather than recalculating game rules.
4. Keep credentials/hashes, private session data, unrevealed target selection,
   solver proofs, preparation inputs, and unapproved diagnostics/history out.
   Public preparation failure feedback must not leak solutions or approve a live
   retry/recovery policy. Never require a public DTO to reconstruct server state.
5. Add runtime validators for the reviewed public snapshot shapes, including
   phase-specific nested data, finite safe numeric values, allowed coordinates,
   bounded arrays, target/robot variants, seat references, and cross-field
   consistency required by the design. Reuse existing validation where suitable;
   do not run a solver or replay unbounded histories to parse a snapshot.

## Tests and acceptance

- Lobby and every match phase have valid serializable fixtures; no deadline in
  Thinking, no active attempt outside Demonstrating, no extra round after Finished.
- Host/roster references, fixed board identity, official versus attempt positions,
  accepted bids, retained move count, scores, and result fields are preserved.
- Projection does not mutate source state. Poison source fixtures with fake
  top-level and nested credential/proof/private fields and verify that none appear
  in the serialized public output. Checking TypeScript types alone is insufficient.
- Validate/reject inconsistent phase fields, malformed board/robot/target data,
  invalid roster references, duplicate IDs, and boundary/collection violations.
- All 17 public targets are compatible with the board display. Future selection
  data and solver witnesses are not needed to render the snapshot.
- Positive shared winners remain model-derived; the T12 all-zero "No winner"
  display requires no new scoring rule or server-selected arbitrary winner.

Run shared tests/type checks and relevant match/engine checks if dependencies
change. Public projection helpers must not introduce an app/server dependency,
new room authority, transport, persistence, or network integration into shared.

---

## Reviewed definition

This makes the approved T13.1 public-state proposal concrete. The definitions
below record the reviewed contract; the implementation follows them in
`packages/shared`. No new gameplay, transport, authentication, or recovery policy
was added. Historical type sketches describe shapes rather than runnable examples.

### 1. What a snapshot contains

A snapshot is the public room state at one revision. Every player receives the
same public state, including the host. It is enough to draw the current screen
without reconstructing earlier messages or calculating authoritative game actions.

T13.3 defines `PublicRoomState`, its nested values, projection, and validation.
T13.4 will implement the surrounding server-message envelope:

```text
room.snapshot message:
  version: 1
  type: "room.snapshot"
  serverTimeMs: authoritative send-time timestamp
  state: PublicRoomState
```

`serverTimeMs` is outside state: sending the same revision later changes the
send-time metadata, not the public room state. This timestamp and the deadline
help display a countdown; only the server decides when bidding ends.
The private `room.entered`/`session.bound` replies in T13.4 tell the recipient
their own `seatId`. There is no shared `you` field in a snapshot.

### 2. Room fields shared in every phase

| Field | Meaning |
| --- | --- |
| `roomId` | Permanent unique identity of this room, never reused |
| `roomCode` | Shareable six-character invitation code, not an identity credential |
| `revision` | Nonnegative safe integer identifying this committed public state |
| `hostSeatId` | The current host's public seat ID; must exist in `players` |
| `players` | Original-order public roster: `{ seatId, nickname, connected }` |
| `puzzle` | Entire selected board: `{ id, name, board, targets, initialRobots }` |
| `status` | `lobby`, `playing`, or `finished`; determines the remaining fields |

`board` is exactly `{ blockedCells, walls }` using the existing engine coordinate
and blocked-edge types. `targets` contains all 17 existing colored/wildcard target
objects, not just the active target. `initialRobots` contains the four catalog
starting positions; these are the lobby preview, never the current match positions.
The full selected geometry is sent so an older client catalog cannot silently
render different walls for the same board ID.

The roster has 1–6 players in the lobby and 2–6 after starting. During the match,
seat IDs, names, and their order match the fixed T11 roster. Connection status
and host are room metadata, not fields in the pure match model. `connected`
means the server currently regards the seat as connected; exact disconnect,
multi-tab, host transfer, and grace policies remain T17 responsibilities.

### 3. The three room variants

| Room status | Additional fields | What the UI displays |
| --- | --- | --- |
| `lobby` | `lobbyId` | Board preview, roster, host Shuffle/Start buttons |
| `playing` | `match`, whose phase is not `finished` | Preparing, Thinking, Bidding, Demonstrating, or Round Result |
| `finished` | `match`, whose phase is `finished` | Full-screen final results |

These are exact variants, not one object with many nullable fields. Lobby has
no `match`, scores, active target, or attempt. Playing/Finished have no `lobbyId`.
The server creates a fresh lobby ID on return to the lobby and a fresh match ID
on a later explicit start. Room ID/revision continue across those transitions.

### 4. Match fields shared in every match phase

| Field | Meaning |
| --- | --- |
| `matchId` | Identity of this specific match, used to reject outdated requests |
| `phase` | One of the six existing T11 phases |
| `completedRounds` | Number of resolved rounds, not the displayed active round number |
| `scores` | Map from every roster seat ID to its current nonnegative score |
| `officialRobots` | All four committed positions, carried forward after a success |
| `usedTargetIds` | Revealed target IDs, including targets from failed/skipped rounds |

No second copy of `players` or `puzzle` is nested inside `match`; both already
exist at room level. The later UI adapter reads those values together rather
than assuming a public match is identical to internal `MatchState`.

### 5. Phase-specific match fields

#### Preparing

Add only `preparation: { status }` with one of:

- `working`: this round's target is not revealed; preparation is awaiting work
  or running. This is not a promise that a background worker exists.
- `deferred`: bounded validation did not finish conclusively.
- `unavailable`: the selection call could not provide an eligible verified target.
- `error`: a preparation operation encountered an unexpected failure.

There is no `round`, selected next target, deadline, or attempt. Detailed reasons,
budgets, candidate diagnostics, and solver results stay private. This status does
not authorize a Retry command or decide live recovery policy.

#### Thinking

Add `round: { number, targetId, startRobots }`.

`targetId` resolves to exactly one target in `puzzle.targets`; it does not duplicate
the target artwork/position. `startRobots` records all four positions at reveal.
There are no accepted bids yet, and no deadline or attempt.

#### Bidding

Add the same `round`, plus:

- `bids`: nonempty list of `{ seatId, value, firstAcceptedOrder }`.
- `deadlineAtMs`: the absolute server-owned bidding deadline.

One accepted bid per participating seat, up to six; non-bidders remain in the
room roster, not as fake/null bid entries. The order marker is retained on an
own-bid reduction. The UI sorts for display using value, then this original
priority; it does not trust local submission times. No attempt exists yet.

#### Demonstrating

Add the same `round`, plus:

- `bidderQueue`: nonempty frozen final bids sorted by value/first accepted order.
- `activeBidderIndex`: valid zero-based position in that queue.
- `attempt: { id, version, robots, moveCount }`.

The active seat and bid limit come from the queue entry; they are not separately
editable duplicate fields. `attempt.robots` is the visible board during the
attempt; `officialRobots` stays committed at round start until success.

Attempt ID/version come from the authoritative room adapter. ID changes for the
next bidder; version starts at zero and increases on accepted move/undo/reset
changes, not on blocked inputs/no-ops. Version is not `moveCount`, because Undo
and Reset decrease retained count. `moveCount` is derived from the server's
current history; that history itself is not broadcast. There is no timer.

#### Round Result

Add the same `round`, plus exactly one `outcome`:

```text
Success:
  { kind: "success", winnerSeatId, winningBid, moveCount }
Nobody solved:
  { kind: "all-bidders-gave-up" }
Host skipped before bidding:
  { kind: "no-bid-skip" }
```

These are the existing T11 outcome fields. Scores and official robot positions
already reflect resolution; Continue does not award another point or commit
positions again. There is no active attempt, queue, bids, or deadline.

#### Finished

Only the common match fields, with `phase: "finished"` and
`completedRounds: 10`. No active `round`, outcome/attempt/queue, or deadline.

Final rankings and positive shared winners are derived from `players` and
`scores`. If all scores are zero, the UI displays the approved "No winner"
variant. No redundant leaderboard, arbitrary winning seat, trophy flag, or
presentation labels are sent by the server.

### 6. Proposed type organization

This is a documentation sketch, not a change to `packages/shared/src`:

```ts
type PublicPlayer = Readonly<{
  seatId: string;
  nickname: string;
  connected: boolean;
}>;

// Exact existing engine fields, explicitly copied, without authoring metadata.
type PublicPuzzle = Readonly<{
  id: string;
  name: string;
  board: Board;
  targets: readonly Target[];
  initialRobots: RobotPositions;
}>;

type PublicRound = Readonly<{
  number: RoundNumber;
  targetId: string;
  startRobots: RobotPositions;
}>;

type PublicMatchBase = Readonly<{
  matchId: string;
  scores: Readonly<Record<string, number>>;
  officialRobots: RobotPositions;
  usedTargetIds: readonly string[];
}>;

type PublicMatch = PublicMatchBase & (
  | { readonly phase: 'preparing'; readonly completedRounds: UnfinishedRoundCount;
      readonly preparation: { readonly status: 'working' | 'deferred' | 'unavailable' | 'error' } }
  | { readonly phase: 'thinking'; readonly completedRounds: UnfinishedRoundCount;
      readonly round: PublicRound }
  | { readonly phase: 'bidding'; readonly completedRounds: UnfinishedRoundCount;
      readonly round: PublicRound; readonly bids: NonEmptyBids; readonly deadlineAtMs: number }
  | { readonly phase: 'demonstrating'; readonly completedRounds: UnfinishedRoundCount;
      readonly round: PublicRound; readonly bidderQueue: NonEmptyBids;
      readonly activeBidderIndex: number;
      readonly attempt: { readonly id: string; readonly version: number;
        readonly robots: RobotPositions; readonly moveCount: number } }
  | { readonly phase: 'round-result'; readonly completedRounds: RoundNumber;
      readonly round: PublicRound; readonly outcome: RoundOutcome }
  | { readonly phase: 'finished'; readonly completedRounds: 10 }
);

type PublicRoomBase = Readonly<{
  roomId: string;
  roomCode: string;
  revision: number;
  hostSeatId: string;
  players: readonly PublicPlayer[];
  puzzle: PublicPuzzle;
}>;

type PublicRoomState = PublicRoomBase & (
  | { readonly status: 'lobby'; readonly lobbyId: string }
  | { readonly status: 'playing';
      readonly match: Exclude<PublicMatch, { phase: 'finished' }> }
  | { readonly status: 'finished';
      readonly match: Extract<PublicMatch, { phase: 'finished' }> }
);
```

`Board`, `Target`, `RobotPositions` are engine types; `RoundNumber`,
`UnfinishedRoundCount`, `NonEmptyBids`, `RoundOutcome` are public match types.
Reuse types where they exactly describe public data; runtime projection must
still select known fields, and runtime validators must enforce all boundaries.

### 7. Projection and validation responsibilities

The implementation checkpoint will provide two separate operations:

1. **Projection:** build a new `PublicRoomState` from authoritative room metadata
   and an optional T11 match. Explicitly copy allowed fields at every level.
   Unknown private fields in the source never get copied into the output.
2. **Validation/parsing:** accept an unknown incoming public state, check exact
   variants and nested constraints, and return an owned public value or a bounded
   error. Unknown fields in a received public snapshot are rejected, not ignored.

Proposed public entry points for the later implementation are
`projectLobbyState`, `projectMatchState`, and `parsePublicRoomState`. They operate
on data only. No `room.snapshot` JSON envelope parser is implemented until T13.4.
The future signatures and errors will follow this separation; names can be
adjusted at review without changing the wire fields above.

Projection inputs are not a new persisted RoomState: only known room ID/code,
revision, host, public roster/connection metadata, lobby/selected puzzle or T11
match, and phase-appropriate attempt/preparation metadata. During a match, roster
identity/order and puzzle come from the authoritative T11 match; connection/host
metadata must agree with those seats. Attempt metadata is required only during
Demonstrating; safe preparation status maps the internal result/room activity.
No source input contains a client-selected score, authoritative time, or result.

Review clarification: attempt metadata carries match ID, round number, active
bidder index and seat ID in addition to public id/version. Projection checks all
four bindings against the current T11 attempt before exposing id/version. The
internal attempt's round-start positions must also match the current round.

Preparation metadata is bound to match ID/completed-round count and has exactly
one activity value (`idle`, `pending`, or `failed`). Pending maps to `working`;
failed maps to `error`; idle maps T11 `not-attempted` to `working`, `deferred` to
`deferred`, and `unavailable` to `unavailable`. Pending/failed may supersede the
previous selection result while a retry runs/fails. No diagnostics are copied.

Projection validates the completed public value before returning it, so an invalid
source cannot yield a partly valid public snapshot. Failures return a bounded
error, never a raw room/model object or exception text. Each returned array/object
is owned; neither operation mutates authoritative input or keeps nested references
to it. These operations do not change room revision, generate IDs, schedule work,
check credentials, persist state, or compute moves/solutions.

### 8. Validation rules to enforce during implementation

Use the approved T13.1 limits: canonical UUIDs, canonical normalized nicknames and
room codes in server output, 64-character board/target IDs, board name limit,
fixed 16×16 geometry/center, exactly 17 targets, safe numeric values, and bounded
arrays. Snapshot validation must reject noncanonical server text instead of
silently renaming players/reformatting codes. Protocol normalization of incoming
create/join requests remains T13.2's responsibility.

Also validate these bounded cross-field relations:

- Unique roster seat IDs, host in roster, unique blocked cells/normalized wall
  edges/target cells, four distinct legal robot positions, and existing referenced
  targets/seats. Different wall edges may share endpoints to form their angles.
- Exactly one score per roster seat, each 0–10; score sum <=completed rounds.
- In Preparing, used-target count equals completed rounds (0–9).
- In Thinking/Bidding/Demonstrating, round number is completed rounds + 1,
  used-target count is completed rounds + 1, and its last ID is the active target.
- In Round Result, round number/used-target count equal completed rounds (1–10),
  and the last used ID is that round's target. Finished has ten used IDs and ten
  completed rounds. Used IDs are unique and present in the supplied puzzle.
- Round-start robots equal official robots in Thinking/Bidding/Demonstrating;
  a no-point result also keeps official positions equal to round start. Success
  instead preserves the committed official positions and valid public outcome.
- Bidding has 1–6 valid bids; unique seat IDs and original-order values 0–5.
  Demonstrating has 1–6 ordered queue entries, a valid active index, exact attempt
  metadata, and retained count between zero and the active bid. Zero retained
  moves means attempt positions equal round start; more moves can legitimately
  end at the same positions, so do not infer count from positional differences.
- A success outcome references a roster seat with a positive score, has a
  positive safe-integer bid, and 1 <=moveCount<=winningBid. No-point outcomes
  do not carry success-only fields. The existing engine's cheap target-completion
  check must confirm success using official final positions. Round-start positions
  must not already satisfy the revealed target; a still-active demonstration must
  not already be solved. These are coordinate checks, not solver runs or proof
  replay. No rules are proved by trusting a UI label.
- Required phase fields exist and fields from other variants are absent. There
  is no client-clock comparison: a delayed snapshot does not become malformed
  because its deadline elapsed while traveling to the phone.

No validation run may replay unbounded history or invoke the solver. Structural
consistency does not prove that a target is solvable or that past actions were
authorized; the authoritative engine/match/server remain responsible for that.

T13.4's encoded message parser will enforce the approved 65,536-byte server-message
limit before JSON parsing. T13.3 must measure complete catalog/six-player fixture
sizes with realistic envelope overhead, and enforce its finite nested limits.
If an otherwise approved snapshot cannot fit, stop for review; do not truncate
history/state, reduce valid bid values, or invent an unreviewed partial protocol.

### 9. Information that must never be public

- Cookie values, private session IDs, credential verifiers/hashes, socket bindings,
  or per-recipient authentication context.
- T10 proofs, solver moves/statistics, candidate lists/order, search budgets,
  unrevealed selected target, or future round choices.
- Internal undo history (`attempt.moves`) or duplicate private attempt state.
- Raw preparation/validation exceptions, stacks, storage records, cached command
  requests, deduplication tables, or unknown nested authoring/server fields.
- UI-only state: selected robot, bid draft, focus/animation, the Act as identity,
  rendered labels, or a private `You` indicator baked into shared state.

### 10. Review and implementation evidence

The owner authorized implementation after review. Readonly public types live in
`publicState.ts`, strict parsing in `parsePublicRoomState.ts`/`stateValidation.ts`,
and explicit projection in `projectPublicState.ts`. The public entry points are
`parsePublicRoomState`, `projectLobbyState`, and `projectMatchState`; failures
are bounded `invalid-snapshot` / `invalid-projection` codes, never source values.

The puzzles workspace dependency reuses existing bounded geometry/catalog
validation (including wall-angle rules), without importing a solver into the
runtime parsing path. Source match IDs for multiplayer projection must already
be canonical protocol UUIDs; old local fixture names are not silently rewritten.
All nested projected/parsing output is owned, and unknown private source fields
are omitted rather than serialized. No server or UI integration was added.

`publicState.test.ts` adds 58 tests, including real-T11 phase/outcome/ten-round
fixtures, two-/six-player matches, one-player lobby, metadata binding/status
mapping, malformed public values, coordinate success checks for colored/wildcard
targets, nested private-field injection, and snapshot ownership/round-tripping.
All five catalog boards and a dense valid 468-wall fixture with maximum-length
Unicode names/IDs and envelope overhead fit within 65,536 UTF-8 bytes. The dense
fixture checks structure/size only; it is not claimed solvable. No solver benchmark
or real network/device verification is claimed by these tests.

Verification: all 243 shared / 787 workspace tests, workspace type checks,
production build, and offline frozen installation passed. Whitespace and local
documentation links were checked. No gameplay/UI/server code changed; T13.4
server replies/envelopes remain pending, and nothing was committed automatically.
