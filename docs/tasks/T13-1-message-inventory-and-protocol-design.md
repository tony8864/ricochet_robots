# T13.1 — Message Inventory and Protocol Design

## Status and purpose

Design approved by the owner on 2026-10-26. First checkpoint in
[T13](T13-typed-protocol-and-validation.md).
Design only. Review the product/architecture, public match contracts, local
controller, and current setup/bidding/demonstration/results interactions.

Produce a concrete protocol proposal for owner review before writing validators.
Do not infer approval of exact message fields from the illustrative names in
the architecture or this task.

## Work

1. Walk through create, join, lobby preview/shuffle, start, preparation, thinking,
   bidding, demonstration, round result, final results, and New Match. Include
   existing-seat reconnect and fresh-snapshot requests without implementing them.
2. Write an inventory mapping each request to its payload, permitted caller and
   phase, resulting public state, private response if any, and future owner task.
   Include bid submission/reduction; move/undo/reset/give-up; confirmed no-bid
   skip; host Continue/View Results; and host return-to-lobby New Match.
3. Identify operations with no client command: deadline expiry, target validation,
   score calculation, bid ordering, and successful position commits. Explain how
   the server maps authorized requests into T11 actions/context.
4. Propose a discriminated JSON contract for request envelopes, full snapshots,
   private membership/session responses, command outcomes, and required lifecycle
   errors. Keep create/join bootstrap distinct from already authenticated room
   commands. Do not require a room identity before a room exists.
5. Separate transport-neutral shapes from HTTP/bootstrap/WebSocket integration.
   Propose where credentials travel securely without putting them in URLs,
   broadcasts, ordinary game actions, or logs. Authentication is not implemented
   by checking a credential's string shape.
6. Specify command IDs and their uniqueness scope, protocol version handling,
   room revision lifetime, authoritative time/deadline representation, and how
   clients identify stale snapshots across room/match changes.
7. Propose action context sufficient to reject a delayed move/Continue from a
   previous match, round, or attempt. Distinguish this from deduplicating a retry.
   Do not impose an exact room-revision match on every competing bid.
8. Specify responses for accepted, no-op, rejected, duplicate, and ID-conflict
   cases. Account for a rejection that follows independently due state change;
   decide how acknowledgments and authoritative snapshots correlate.
9. Propose explicit input limits and normalization, unknown-field handling,
   collection/encoded-size bounds, and a compact safe error vocabulary.
   Preserve duplicate nicknames and existing positive-safe-integer bidding rules.
10. Resolve board catalog/geometry representation, safe preparation feedback,
    and which demonstration fields the UI actually needs. Separate public state
    from persisted room state, credentials, solver data, and undo internals.

## Deliverable and review gate

Add the proposal to this task or a directly linked design document. Include
representative JSON examples with fake identifiers only, a permissions/message
matrix, validation limits, and a complete match/reconnect/rematch walkthrough.
State which decisions are proposed, approved, or intentionally deferred.

Ask for approval of security/architecture/input-policy choices before T13.2.
If an unresolved policy blocks a particular message, flag it rather than
inventing host-disconnect, permanent-departure, or solver-recovery behavior.
The first-accepted-bid tie rule is already established; do not reopen it.

## Acceptance

- Every existing multiplayer-relevant UI action has a request or an explicit
  explanation that no request is needed.
- Every request has a later authorization owner; internal operations cannot be
  submitted by pretending to be a trusted controller.
- Public/private data, input limits, revision/ID semantics, and stale-action
  rules are sufficiently precise to implement without consequential guesses.
- The owner reviews the design. No runtime code, infrastructure, UI, or game
  rules change in this checkpoint.

Validate documentation links and consistency. Do not claim automated protocol
tests or two-browser play exist at this design stage.

---

## Protocol proposal — review draft, 2026-10-25

The owner approved this protocol proposal on 2026-10-26 after reviewing identity,
snapshots, and the message inventory, then explicitly requested T13.2. Proposal
wording below records that design; the deferred decisions remain deferred.
Approval is not a claim that authentication, networking, or retry handling exists.
T13.2 implements request contracts/validation only; later tasks remain separate.

### 1. Evidence and established behavior

The inventory was checked against:

- `packages/match/src/commands.ts`, `model.ts`, and the public reducer: six match
  phases, separate player/internal actions, trusted actor/host/time context.
- `apps/web/src/local/controller.ts`: submit actions, expiry, preparation, and
  guarded host continuation; this local adapter is not network authentication.
- `SetupPreview.tsx` and `local/startLobbyMatch.ts`: host shuffle/start and
  host-only Finished-to-lobby reset without an automatic next match.
- `App.tsx`, `RoundResultModal.tsx`, and `MatchResults.tsx`: phase-specific
  controls, watcher view, Continue/View Results, and final results.
- Engine `AttemptState`: undo history exists for server rules but the UI needs
  current robots and retained move count, not a broadcast history.

Established: 2–6 players at start, ten rounds, 60 seconds after the first bid,
own bid may only decrease, any positive safe-integer competing bid, original
first-bid tie priority, server-owned validity/time/scores, and no late joins.
Duplicate nicknames remain allowed. New Match returns to the lobby with the same
seats/host and permits shuffle before a separate Start Match action.

The soft target-cell fill and all-zero "No winner" display are approved UI
changes; stale outline/all-zero-winner wording in older docs is not a new wire
rule. T13 will not change rendering or model scoring.

### 2. Transport and identity — approval required

Propose a same-origin HTTPS bootstrap API plus a WSS connection per room.
The production frontend and `/api` appear under one origin; development uses
an approved local proxy/HTTPS setup in T14. No endpoint is created by this task.
Different-origin hosting would require revisiting this cookie/Origin design.

Use one opaque anonymous browser-session credential in a host-only cookie:
`__Host-rr-session`, `Path=/`, `Secure`, `HttpOnly`, `SameSite=Lax`, no `Domain`.
The server generates at least 256 random bits, stores a verifier rather than
logging/exposing the raw value, and maps that authenticated session to its seat
in each room. It is a private credential, not an account, nickname, or public ID.
Session lifetime/rotation/revocation must be agreed before T14 implementation;
room expiry and disconnect grace remain separate T17 policies.

JavaScript does not read/store/send the credential in JSON, localStorage, URLs,
query strings, WebSocket subprotocols, or game actions. The browser attaches the
cookie to same-origin HTTP and WebSocket handshakes. Require exact allowed-Origin
checks for bootstrap POSTs and every upgrade; reject untrusted/missing browser
Origin on these mutation/upgrade routes. Also require JSON content type for
bootstrap POSTs. Cookies alone and SameSite alone are not authorization/CSRF
protection. Every accepted command still resolves a live authenticated seat and
checks current room/host/phase authority.

Proposed bootstrap routes and request bodies use the envelopes in section 3:

| Route | Request | Authentication / effect |
| --- | --- | --- |
| `POST /api/session` | `session.open` | Establish/reuse anonymous cookie; no room or seat is created |
| `POST /api/rooms` | `room.create` | Requires browser session; creates one room and host seat |
| `POST /api/rooms/join` | `room.join` | Requires browser session plus invite code; creates a seat only in an open lobby |
| `POST /api/rooms/{roomId}/resume` | `session.resume` | Cookie must already map to a seat; never allocates a new one |
| `GET /api/rooms/{roomId}/socket` | WebSocket upgrade, no JSON body | Cookie/Origin authenticated before upgrade; binds connection to room and seat |

Do `session.open` before create/join so their retries are bound to a private
credential even if an HTTP response is lost. Retrying session establishment
before any room exists does not create duplicate rooms/seats. Create/join
handlers must deduplicate and establish membership atomically in T14.
An existing member joining the same room resumes their seat, never gets another
seat or changes their nickname; this also works after match start. Another
browser session with the same nickname has no right to that seat.

One browser profile has one seat per room. To test separate people, use different
devices, browsers, or profiles; two ordinary tabs share identity. Multiple-tab
connection arbitration is a T17 decision, not approval to eject/replace a seat.
The local Act as tool remains development-only and never becomes a wire command.
Mobile testing over a plain LAN `http://192.168...` address cannot be assumed to
exercise production Secure-cookie authentication; plan secure testing in T14.

Security rationale: [OWASP WebSocket security guidance](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
supports explicit handshake Origin checks and avoiding sensitive message logs;
[MDN secure cookie guidance](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies)
describes the proposed cookie attributes. These references do not verify our
future implementation. Infrastructure, session storage and authentication remain
unimplemented until later tasks.

### 3. Client envelope and message inventory

All JSON requests have exactly `version: 1`, `commandId`, and `command`.
The discriminator is `command.type`; payload fields live inside `command`.
Bootstrap requests have no top-level `roomId` or `context`; resume carries its
room ID inside its command and must match the HTTP route. Authenticated socket
requests also require top-level `roomId` and `context`, matching the bound room.
Unknown fields are rejected, not silently stripped or interpreted as defaults.

`commandId` identifies one logical request. A transport retry preserves the
complete normalized request and its ID; a new user action gets a new ID.
No envelope accepts `actorSeatId`, `hostSeatId`, client time, a score, robot
positions, a solution, or a claimed result. Context is an untrusted precondition
compared with server state, never authority.

Context variants have exact keys:

- Lobby: `{ lobbyId }`.
- Round: `{ matchId, roundNumber }`.
- Attempt: `{ matchId, roundNumber, attemptId, attemptVersion }`.
- Finished: `{ matchId }`.
- State request: `{}`.

The server creates a new `lobbyId` initially and on every return to the lobby,
a new `matchId` on each start, and a new `attemptId` for every bidder attempt.
Persist these identities with room state, not only on sockets. `attemptVersion`
starts at zero and increases on accepted move/undo/reset changes; it is not the
retained move count, because Undo/Reset can decrease that count. These are room
integration metadata; do not put networking identity into pure engine geometry.

| Request `command.type` | Additional command fields | Context / who / phase | Result and later owner |
| --- | --- | --- | --- |
| `session.open` | none | Bootstrap, visitor | Private session acknowledgment + cookie; T14 |
| `room.create` | `nickname` | Bootstrap, authenticated browser | New room/host and private membership reply; T14 |
| `room.join` | `roomCode`, `nickname` | Bootstrap, authenticated browser; new seat only in Lobby with space | Private membership reply, public roster update; existing member resumes; T14 |
| `session.resume` | `roomId` | Bootstrap, existing authenticated member, any live room phase | Private membership reply/current snapshot; identity T14, recovery T17 |
| `state.request` | none | Empty context, any authenticated room seat | Current full snapshot, no user-requested state change; T14–T17 |
| `board.shuffle` | none | Lobby context, current host, Lobby | Another catalog board chosen by server; T14 |
| `room.start` | `boardId` | Lobby context, current host, 2–6 seats; board ID must still match preview | Lock current board/roster, create match, enter Preparing; T14/T15 |
| `bid.submit` | `value` | Round context, any match seat, Thinking/Bidding before expiry | First bid starts deadline, or accept new/lowered own bid; T15 |
| `attempt.move` | `robotId`, `direction` | Attempt context, current active bidder, Demonstrating | Updated robots/count, or automatic success; T16 |
| `attempt.undo` | none | Attempt context, active bidder, Demonstrating | Restore previous retained move; T16 |
| `attempt.reset` | none | Attempt context, active bidder, Demonstrating | Restore all round-start positions/count zero; T16 |
| `attempt.giveUp` | none | Attempt context, active bidder, Demonstrating | Roll back and create next attempt or Round Result; T16 |
| `round.skip` | `confirmed` boolean | Round context, current host, Thinking only | No-point Round Result when confirmed; T15 |
| `round.continue` | none | Round context, current host, Round Result only | Preparing after rounds 1–9; Finished after round 10; T15/T16 |
| `match.returnToLobby` | none | Finished context, current host, Finished only | New lobby identity, same seats/host and board preview; no auto-start; T14–T16 |

`round.continue` serves both Continue and View Results: the server knows whether
the completed round is number 10. The UI cannot choose which phase comes next.
`match.returnToLobby` explicitly avoids the ambiguous implication that
`match.rematch` would immediately begin round 1.

Robot selection, editing a bid draft, opening/canceling skip confirmation,
displaying scores/results, and animation are local presentation: no message.
The local Preparing Retry button does not establish an approved live recovery
policy. There is no public `round.retryPreparation` in v1; resolve that policy
before live T15 preparation, or return for a reviewed protocol addition.
No `room.leave`, host kick/transfer request, nickname edit, heartbeat JSON,
or abandoned-attempt skip is specified now. Closing a socket is not permanent
departure. T17 must settle those rules before new commands are added.

### 4. Public snapshot — explicit projection, not serialized server state

Propose a full `room.snapshot` message:

```text
{ version: 1, type: "room.snapshot", serverTimeMs, state: PublicRoomState }

PublicRoomState common fields:
  roomId, roomCode, revision, hostSeatId
  players: [{ seatId, nickname, connected }]
  puzzle: { id, name, board: { blockedCells, walls }, targets, initialRobots }

Lobby variant:    status: "lobby", lobbyId
Playing variant:  status: "playing", match: PublicMatch (not Finished)
Finished variant: status: "finished", match: PublicMatch (Finished only)
```

Every recipient receives the same public `state` for a revision. `serverTimeMs`
is send-time metadata outside state and may differ on a resync without a revision
change. Recipient seat identity is sent privately, never as a shared `you` field.
The server time assists countdown display; clients do not use it to accept bids.

Send the entire selected catalog geometry and targets rather than requiring an
identical client catalog bundle. IDs label boards; v1 geometry is authoritative
and fixed inside a match. Use current zero-based integer coordinates and
normalized blocked edges, exactly the four blocked center cells, all four robot
keys, and all 17 target identities/color-symbol combinations. Catalog starts are
public lobby data; they never override current official match positions.
No board-generation seed, future target order, catalog-authoring metadata, or
solution accompanies it. The server still selects/validates its own catalog;
clients never submit a board layout.

`PublicMatch` common fields: `matchId`, `phase`, `completedRounds`, `scores`,
`officialRobots`, `usedTargetIds`. Scores have exactly one key per match seat;
the public room roster supplies names/seat IDs, avoiding a second divergent
roster in the payload. During a match that roster is locked; connection status
and current host may change under later T17 rules without changing match seats.

Phase-specific fields:

| Phase | Public fields in addition to common fields |
| --- | --- |
| `preparing` | `preparation: { status }`, where status is `working`, `deferred`, `unavailable`, or `error`; no round/target until verified |
| `thinking` | `round: { number, targetId, startRobots }` |
| `bidding` | `round`, `bids: [{ seatId, value, firstAcceptedOrder }]`, `deadlineAtMs` |
| `demonstrating` | `round`, sorted `bidderQueue`, `activeBidderIndex`, `attempt: { id, version, robots, moveCount }` |
| `round-result` | `round`, `outcome` using the existing three public RoundOutcome variants |
| `finished` | Common fields only; `completedRounds: 10` |

Resolve `round.targetId` against the snapshot's targets. The phase/count/used-ID
relations follow T11: active round number is completed rounds + 1, result round
number equals completed rounds, and the revealed target is already marked used.
Used IDs count equals completed rounds in Preparing/Result/Finished and equals
completed rounds + 1 in Thinking/Bidding/Demonstrating. Result/Finished have no
writable attempt. Only Bidding has a deadline. Match scores sum to no more than
completed rounds. Queue/bid seats must exist and not duplicate; queue order is
value then first accepted order. Public validation must check these bounded
structural relations but never solve targets or replay move histories.

Projection explicitly reconstructs every allowed nested object. Do not spread
the entire room, MatchState, T10 result, or AttemptState. No `attempt.moves`,
private session IDs/verifiers, tokens, solver proofs/statistics/candidate lists,
future selections, or raw errors. Pending/deferred/unavailable preparation maps
to the safe status only; detailed diagnostics stay server-side. The public
snapshot contains no retry permission until a live policy is reviewed.

Public `moveCount` is derived from retained server history; Undo and Reset
availability can be derived from it. Success commits remain model-owned. UI
standings/ranks/winners are derived from public scores/roster, preserving stable
order and the reviewed all-zero display. Do not broadcast a redundant score table
or a separate client-editable winner.

### 5. Server messages, replies, and safe errors

Proposed server JSON variants use exact fields, all with `version: 1`:

| `type` | Fields besides version/type | Delivery |
| --- | --- | --- |
| `session.ready` | `commandId`, `serverTimeMs` | Private HTTP bootstrap; credential is Set-Cookie only |
| `room.entered` | `commandId`, `roomId`, `seatId`, `membership` (`created`, `joined`, or `resumed`), `serverTimeMs`, `state` | Private create/join/resume HTTP reply; latest public state, no raw credential |
| `session.bound` | `roomId`, `seatId`, `serverTimeMs`, `state` | Private first socket message after successful authentication; not broadcast |
| `room.snapshot` | `serverTimeMs`, `state` | Broadcast on public change; unicast on resync/reconnect |
| `command.result` | `roomId`, `commandId`, `outcome`, `processedRevision`, `currentRevision`, `duplicate`, `serverTimeMs` | Private socket reply for a well-formed authorized-seat request |
| `request.rejected` | `commandId`, `reason`, `serverTimeMs` | Private bootstrap failure with a validated request ID |
| `protocol.error` | `commandId` (UUID or null), `reason`, `serverTimeMs` | Private framing/schema/version failure; never echo offending data |
| `room.closed` | `roomId`, `lastRevision`, `reason` (`expired` or `unavailable`), `serverTimeMs` | Terminal room notice; exact expiry policy remains T17 |

The shapes do not authorize sending a state before authenticating its recipient.
`room.entered`/`session.bound` seat IDs must exist in their included state; their
room IDs must match it. `processedRevision` and `currentRevision` are nonnegative
safe integers with processed <= current. A result records the original outcome
and processed revision; a retry can observe a later current revision.

`command.result.outcome` is one of:

- `{ status: "accepted" }`.
- `{ status: "no-op", reason }`, with public reasons `same-bid`, `blocked-move`,
  `empty-undo`, `already-reset`; `state.request` uses `snapshot-requested`.
- `{ status: "rejected", reason }`, with public reasons `wrong-phase`,
  `not-host`, `not-active-bidder`, `confirmation-required`, `invalid-bid`,
  `bid-increase`, `bidding-closed`, `bid-limit`, `match-finished`, `stale-context`,
  `not-enough-players`, `preview-changed`, or `command-id-conflict`.

`request.rejected` reasons: `not-authenticated`, `room-not-found`, `room-full`,
`match-started`, `seat-not-found`, `command-id-conflict`, `rate-limited`,
`temporarily-unavailable`. Do not distinguish an absent versus inaccessible
room to an unauthenticated caller. Bootstrap route authentication happens first.

`protocol.error` reasons: `invalid-json`, `invalid-message`,
`unsupported-version`, `message-too-large`. Only include a command ID if its
canonical format was independently validated; otherwise use null. No dynamic
exception strings, payload fragments, tokens, or field values. The UI maps codes
to friendly text. HTTP status/WS close policy is transport work in T14–T17.
Room capacity/locked-start and business rejections are not JSON syntax failures.
Internal `invalid-context`, `invalid-preparation`, `stale-preparation`, and solver
errors must not be blindly reused as player-facing protocol results.

After a room command result, unicast a current snapshot even if no state changed;
broadcast once when public state changes. A sender may receive both; equal
revisions are harmless. The result only clears/correlates pending input, never
edits robots/scores itself. HTTP membership replies already contain current state.

### 6. Revisions, stale actions, retries, and ordering

Room revision starts at zero in the first completed lobby snapshot and increases
once per externally committed public state change. Joining, shuffle/start,
phase transitions, accepted bid/move/correction, and later connection/host changes
advance it. Unchanged reads/no-ops/rejections and countdown ticks do not. A rejected
request may still trigger a due expiry change and therefore a newer revision.
Batching multiple internal atomic changes into one committed snapshot is allowed;
clients must not expect consecutive delivered numbers or a separate event per step.
Never reset room revision on a rematch or Durable Object restart; persist it.
Never reuse a room ID for a newly created room, even if an expired code is reused.

The client scopes revision comparison by room ID. Apply a greater revision, ignore
an older one, and treat equal-revision state as identical (send-time can differ).
Same revision with different public state is a protocol defect: request resync,
do not merge. A private binding reply establishes which room/seat is being viewed.
On reconnect, reconstruct the whole view from the latest snapshot; no animation
replay or client-computed catch-up. Offline UI cannot submit locally authoritative
actions for later merging.

Command preconditions:

- Bids and skip/Continue compare match ID and round number, then current phase
  and permissions. A first bid is valid from Thinking into Bidding; do not make
  the observed Thinking phase a condition that rejects a competing second bid.
- Attempt requests compare match/round/attempt ID and exact attempt version,
  then current active bidder and current model state. An old reset/give-up cannot
  hit another bidder, round, or a newer version of that same attempt.
- Lobby requests compare lobby ID; Start also compares the displayed board ID.
  There is no exact room-revision precondition that would reject a bid or move
  merely because another player's bid/presence advanced the room revision.
- New Match compares the finished match ID and latest host/phase. It cannot
  reopen a new match using an old result screen.

For attempt input, propose one unresolved state-changing command at a time per
active client. A future adapter may queue intent, but stamps the next request
only after resolving the prior result/current snapshot; it never rebases queued
actions into a different attempt. A stale-context response requests resync rather
than automatically converting an old reset/undo into a new action. This avoids
specifying optimistic move authority; latency/queue UX must be verified in T16.

Deduplication is a server responsibility, not a property of UUID validation:

1. Authenticate and validate the bounded envelope; identify the destination and
   session's seat. Never look up a different seat's cached response by ID alone.
2. Within an authenticated session/destination scope, look up `commandId` before
   treating the request as a new action. For create, scope is that browser session
   plus creation endpoint; for join/resume/in-room commands it includes the room.
3. Same ID + same canonical normalized request returns the recorded original
   outcome, sets `duplicate: true`, and sends latest public state to that member.
   Do not re-run the action even if its original round has ended. Object key
   order is not a payload difference. Different normalized content under the
   same ID yields `command-id-conflict`, never overwrites the original record.
4. Independently due bidding expiry must still be normalized and broadcast even
   on a duplicate/conflicting/stale well-formed request; that normalization does
   not execute its game action again or replace its stored original outcome.
5. For a genuinely new request, check context/host/phase against normalized state,
   invoke the domain action, persist outcome/state/revision consistently, then
   acknowledge and broadcast. Rejected late bids retain the expiry state.

The replay record survives restarts and return-to-lobby/new matches for the room's
lifetime. Bootstrap retries cannot create another room/seat after a lost reply;
private membership responses are rebuilt only for the same authenticated session.
A cached creation cannot recreate an expired room. Retention/capacity protection
must not silently evict records and execute an old ID as new; resource limits are
a server review item before implementation. The request protocol does not promise
exactly-once delivery, cross-device credential recovery, or infinite retention.

### 7. Proposed validation limits and normalization

All counts/times/revisions/versions are finite safe integers. Unknown properties
are rejected at every object level. Only plain JSON values cross the boundary;
no Dates, class instances, functions, NaN, Infinity, or undefined. Pure shared
parsers consume bounded `unknown`/JSON and return stable error codes. Transport
limits raw bytes before parsing; shared code must not import DOM encoders,
Cloudflare, a browser clock, or a solver to validate data.

| Value | Proposed rule |
| --- | --- |
| Protocol version | Exactly integer `1`; other versions fail closed, no guessing/coercion |
| Command/room/seat/match/lobby/attempt ID | Canonical lowercase UUID v4, exactly 36 ASCII characters; fake examples below are valid-format placeholders |
| Board/target ID | 1–64 ASCII lowercase letters/digits/hyphens; must refer to the included authoritative board/targets where applicable |
| Nickname | Trim ends, normalize NFC; 1–24 Unicode code points, at most 96 UTF-8 bytes afterward; raw input at most 256 UTF-8 bytes; reject control characters (Cc), line/paragraph separators and bidi override/isolate controls; preserve internal ordinary spaces, case and duplicate names |
| Room code | Trim ends, ASCII uppercase; exactly 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; raw input at most 16 ASCII characters; no ambiguous `I`, `O`, `0`, `1` |
| Bid | `Number.isSafeInteger(value)` and 1 <= value <= 9,007,199,254,740,991; no lower game cap, no string coercion |
| Round number / completed count | Round 1–10; completed 0–10 with phase-specific relations in section 4 |
| Robot / direction | `red`, `blue`, `green`, `yellow`; `up`, `right`, `down`, `left` |
| Coordinate | Integer row/column 0–15; use documented row-down/column-right convention |
| Server milliseconds / revision / attempt version | Nonnegative safe integer; deadline is absolute server milliseconds, never a client-owned countdown |
| Public roster | 1–6 in Lobby; 2–6 while Playing/Finished; unique seat IDs; host exists; connected is boolean |
| Board geometry | Exactly four fixed central blocked cells; <=480 unique normalized interior blocked edges; valid adjacent endpoints; no client-supplied geometry requests |
| Public target list | Exactly 17 distinct IDs/cells and required color/symbol combinations; each on a legal cell; active/used IDs must exist |
| Board name | 1–80 Unicode code points, <=320 UTF-8 bytes, printable single line |
| Bids / queue / scores | <=6 unique seat entries; score 0–10 per seat; firstAcceptedOrder 0–5 and unique; no key for a non-roster seat |
| Used target IDs | <=10, unique; order retained; count consistent with current phase |
| Public attempt | Four distinct legal positions; moveCount safe integer >=0 and <=active bid; exact id/version; no history array |
| Encoded bootstrap request / client WS message | <=4,096 UTF-8 bytes before JSON parsing; JSON text only, no binary client frames |
| Encoded server reply / snapshot | <=65,536 UTF-8 bytes; finite arrays/objects as above, no solver/history blobs |

Public robot positions must not overlap, enter blocked cells, or leave the board.
Target/wall geometry uses existing bounded engine/catalog validation as appropriate;
these checks do not prove solvability. Snapshot validation must be bounded by the
reviewed collection limits. No artificial smaller bid limit or retained-history
cap may be introduced to make serialization easier; history is not sent.

These size limits are proposals, not measured claims. T13.3/T13.5 must serialize
every current catalog board and worst-boundary valid fixtures, verify UTF-8 size,
and return for review if an allowed snapshot cannot fit. Reject oversize inbound
data before expensive parsing. Never truncate a snapshot or split it into
unversioned partial state. Server byte encoding/counting and rate limits remain
transport/integration work; T13 tests need explicit byte-count fixtures.

### 8. JSON examples — fake values, not runtime code

Private create request, after successful `session.open` cookie establishment:

```json
{
  "version": 1,
  "commandId": "c0000000-0000-4000-8000-000000000001",
  "command": { "type": "room.create", "nickname": "Maria" }
}
```

A bid from the authenticated seat; higher competing bids use the same shape:

```json
{
  "version": 1,
  "commandId": "c0000000-0000-4000-8000-000000000002",
  "roomId": "10000000-0000-4000-8000-000000000001",
  "context": { "matchId": "20000000-0000-4000-8000-000000000001", "roundNumber": 1 },
  "command": { "type": "bid.submit", "value": 7 }
}
```

A move based on the current attempt snapshot:

```json
{
  "version": 1,
  "commandId": "c0000000-0000-4000-8000-000000000003",
  "roomId": "10000000-0000-4000-8000-000000000001",
  "context": {
    "matchId": "20000000-0000-4000-8000-000000000001",
    "roundNumber": 1,
    "attemptId": "30000000-0000-4000-8000-000000000001",
    "attemptVersion": 0
  },
  "command": { "type": "attempt.move", "robotId": "red", "direction": "right" }
}
```

An accepted command acknowledgment; it is followed by a full current snapshot,
not instructions for the client to calculate a position or award a point:

```json
{
  "version": 1,
  "type": "command.result",
  "roomId": "10000000-0000-4000-8000-000000000001",
  "commandId": "c0000000-0000-4000-8000-000000000003",
  "outcome": { "status": "accepted" },
  "processedRevision": 12,
  "currentRevision": 12,
  "duplicate": false,
  "serverTimeMs": 1792920000000
}
```

A malformed request response does not echo payload values:

```json
{
  "version": 1,
  "type": "protocol.error",
  "commandId": null,
  "reason": "invalid-message",
  "serverTimeMs": 1792920000000
}
```

Section 4's schema block defines the full snapshot without publishing a long
17-target geometry fixture here. T13.3 must add complete real-board serializable
fixtures and parse them, not use ellipses as valid JSON or a minimal false board.

### 9. Complete lifecycle walkthrough

1. Maria opens the app: establish an anonymous browser cookie with `session.open`,
   then send `room.create`. The private reply identifies her room/seat and includes
   its first lobby snapshot; share only the six-character code or invite URL.
2. Alex opens the invite URL, establishes a different browser session, and sends
   `room.join`. Both sockets bind to their authenticated seats and receive the
   same public roster/board. Neither learns the other's credential.
3. Maria sends `board.shuffle` against the current lobby identity. All receive
   the newly selected full board. `room.start` includes the previewed board ID;
   the server validates host/capacity, locks roster/board, creates the match ID,
   and publishes Preparing. No client can supply an initial robot arrangement.
4. The server performs bounded T10 verification and publishes Thinking with one
   verified unused target, or safe Preparing feedback. It does not reveal a proof
   or silently skip/reset/change the board on failure. Live recovery remains a
   required policy gate before T15, not an assumed automatic retry.
5. Maria bids 7. The server accepts and starts its 60-second absolute deadline.
   Alex may bid 9, then lower to 6; Maria may lower to 6. Bid revisions preserve
   first accepted priority. Every updated public snapshot includes accepted bids;
   the browser countdown does not send ticking commands.
6. Server expiry freezes the queue, restores round-start robots for the first
   bidder, and creates attempt ID/version. Any late bid is rejected while the
   independently updated demonstration state is still sent to everyone.
7. Only the active bidder issues versioned attempt requests. Undo/Reset are free;
   blocked moves are no-ops. Give Up restores all four round-start positions and
   creates another bidder's distinct attempt, or ends with no point.
8. A valid successful move automatically commits all four final positions, scores
   once, and broadcasts Round Result. There is no separate `success` request.
   All clients display the same result; only Maria can `round.continue`.
9. For rounds 1–9, Continue enters Preparing and checks a different unused target
   against official carry-forward positions. After round 10, the same request
   enters Finished; no target eleven is selected. Scores determine single/shared
   positive winners or the all-zero no-winner presentation.
10. Maria sends `match.returnToLobby`. Everyone receives the same fresh lobby
    identity/board preview with their seats/host preserved. Old final scores are
    no longer active lobby match state; fresh zero scores are created only on
    the next explicit Start Match with a new match ID. Shuffle is allowed again.

Reconnect branch: Alex's phone backgrounds or loses WSS. On resume, reuse the
cookie and send `session.resume`/reopen the authenticated socket. The server
normalizes any due expiry, privately binds Alex's original seat, and sends the
latest full snapshot/revision. A new user with the same code/nickname cannot
claim that seat or join the started match. An unresolved prior command is retried
only with its original ID and exact payload after resync, never guessed as a new
move. No late bid becomes valid because it was composed before disconnection.
Missing/expired credentials cannot be replaced using a nickname. Credential-loss
recovery, grace timing, host transfer, permanent departure, and room expiry policy
remain T14/T17 decisions; this draft promises none of those behaviors.

### 10. Review checklist and remaining gates

Approved by the owner on 2026-10-26 before requesting T13.2:

- [x] Full authoritative snapshots with supplied board geometry, no public undo
  history/solver diagnostics, and the explicit phase-specific DTO above.
- [x] Same-origin bootstrap + WSS, anonymous HttpOnly/Secure cookie credential,
  session-to-room-seat mapping, and one seat per room per browser profile.
- [x] Proposed request names, private replies, safe error codes, and the distinction
  between a host Continue request and server-only timer/preparation operations.
- [x] Canonical IDs, six-character invite code, 24-code-point nickname rule,
  strict unknown-field rejection, and encoded message/collection limits.
- [x] Room-wide persistent revisions, command ID retry/conflict rules, and latest
  snapshots accompanying results even when the original command is rejected.
- [x] Match/round/lobby/attempt identity checks plus exact attempt version and
  serialized pending attempt input, without exact-revision checks for bids.

Deferred, not silently approved: credential lifetime/rotation and secure local
testing before T14; bootstrap and room deduplication storage/capacity; server
runtime profiling and failed-preparation recovery before T15; multi-tab policy,
grace/host transfer/departure/expiry before T17. A future need for an additional
message requires a reviewed version-compatible protocol extension, not an
arbitrary string accepted by a permissive parser.

Validation for this checkpoint: documentation link/whitespace checks and manual
comparison with current public contracts/UI actions. No protocol code, runtime
tests, infrastructure, UI changes, or architecture/product edits were made.
Owner review is complete. T13.1 is a completed design checkpoint, not a running
server or security certification. Later runtime work must retain the gates above.
