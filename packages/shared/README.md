# Shared network contracts

## Current T17 protocol

Live HTTP/WSS envelopes now use protocol **v2**; update web/server together and
reload old pages. V1 gameplay is rejected, not automatically converted. Private
match persistence versions and existing replay canonical JSON are unchanged.
T17.3's web recovery now resumes the existing cookie-bound seat automatically and
after live-room refresh, with one validated immutable pending request saved per
tab. This adds no wire version or server-rule change. Gameplay retry is still
explicit/exact; storage routing/seat IDs never authenticate a caller.
`session.bound` includes the recipient's connection ID. `parseSocketMessageJson`
accepts existing client requests or a strict `connection.ping` transport envelope
with roomId/connectionId/positive increasing sequence; it is not an HTTP bootstrap
or match command. Private `connection.pong` echoes ID/sequence/server time and is
never an allowed room broadcast. Ten-second pings renew a server-owned 30-second
lease only while authenticated/live, within existing inbound budget/size bounds.

V2 `command.retry` carries a strictly parsed historical v1 room request, with the
same outer room/command ID and empty context. It is receipt lookup only: no nested
retry or fresh v1 action; missing receipts return `retry-not-found`. Server-side
membership/authentication/canonical comparison remain required. Later grace,
closure and empty-expiry fields are not implemented by T17.2. Historical sections
below describe earlier checkpoints; the actual parsers/types are authoritative.

T13.2 implements client requests; T13.3 adds public room-state types, strict
parsing, and safe projection; T13.4 adds server-message envelopes and parsing.
There is no server, authentication, cookie handling, socket, command deduplication,
or authorization in this package yet. T13.5 audited these contracts on 2026-10-27.

```ts
import { parseClientRequestJson } from '@robot-puzzle/shared';

const parsed = parseClientRequestJson(text);
if (parsed.ok) {
  const request = parsed.value; // owned, validated, normalized ClientRequest
  // A future handler must authenticate/authorize before applying this request.
} else {
  // A bounded error code only; never log the raw request or session cookie.
  const errorCode = parsed.error;
}
```

`parseClientRequest(unknown)` validates already-decoded, transport-bounded
JSON-like objects. `parseClientRequestJson(unknown)` additionally accepts only
text, checks the 4,096-byte UTF-8 limit before JSON parsing, and handles malformed
JSON. Both return `{ ok: true, value }` or `{ ok: false, error }` without echoing
input. Output objects are copies; nickname trim/NFC and room-code trim/ASCII
uppercase are the only text normalization. Other field types are not coerced.

Requests discriminate on `command.type`. Bootstrap commands do not have a
top-level room/context; room commands require the exact reviewed context for
lobby, round, attempt, finished-match, or state-read requests. Unknown keys are
rejected at every object boundary. `round.skip` accepts a boolean confirmation;
false is structurally valid but cannot authorize a skip.

The future transport must bound raw HTTP/WS bytes before allocating/decoding
text, reject binary requests, authenticate the session/seat, validate Origin,
and compare room/match/round/attempt context against authoritative state.
Parsing does not enforce host/turn/phase permissions, lower-only bids, deadlines,
board catalog membership, retry uniqueness, or message rate limits. Never treat
the UUID format, context IDs, or successful parsing as proof of authority.

The approved protocol and remaining server gates are documented in
[`T13.1`](../../docs/tasks/T13-1-message-inventory-and-protocol-design.md).

## Public room state (T13.3)

`parsePublicRoomState(unknown)` validates already-decoded, transport-bounded state
and returns `{ ok: true, value }` or `{ ok: false, error: 'invalid-snapshot' }`.
Unlike client requests, server text must already be canonical; parsing never
silently trims/renames players. Each phase has exact required/allowed fields.
The parser checks bounded geometry/catalog consistency, score/roster/round/target
references, attempt count/positions and cheap target completion, not solvability.

`projectLobbyState(LobbyProjectionInput)` and
`projectMatchState(MatchProjectionInput)` explicitly copy only allowed public
fields and validate the result. They return `invalid-projection` on bad inputs.
Outputs own all nested data. Connection metadata has exactly the current roster
keys; names/order/puzzle/scores come from the match, not a second editable copy.

Demonstration projection requires attempt id/version plus bindings to match ID,
round, active bidder index and seat. Preparing requires metadata bound to match
ID/completed count with activity `idle`, `pending`, or `failed`: pending becomes
working, failed becomes error, and idle exposes only the safe T11 status.
No metadata generates IDs, increments revisions, or authorizes a recovery policy.

The runtime reuses engine and catalog geometry validation, not solver execution.
Undo history, solver witnesses/diagnostics, private credentials and unknown nested
source fields never enter public output. Pure parsing does not authenticate the
sender; future clients must receive authoritative state through trusted transport.
T13.4 owns server envelopes/send-time metadata and the 65,536-byte raw-message
check; T13.3 tests catalog and dense-boundary state sizes with envelope overhead.

## Server messages (T13.4)

`parseServerMessage(unknown)` validates already-decoded bounded server replies.
`parseServerMessageJson(unknown)` additionally checks the total 65,536 UTF-8 byte
limit before JSON parsing. Both return `{ ok: true, value }` or
`{ ok: false, error }` with a bounded protocol error code, never raw input.
Nested snapshots use the T13.3 parser; every returned object is an owned copy.
The future transport must still limit raw bytes before allocating/decoding text.

`PublicServerMessage` contains only `room.snapshot` and `room.closed`.
`parsePublicServerMessage(unknown)` rejects private variants and unknown fields;
future broadcast helpers must validate/send its returned value, not arbitrary
caller objects. `PrivateServerMessage` contains session/bootstrap seat binding,
command results, request rejection, and protocol errors. Seat ID bindings are
private recipient metadata even though the shared roster itself has public IDs.
Credentials remain in HttpOnly cookies/transport headers, never JSON replies.

### Revision, correlation and retry contract

- `commandId` correlates one logical request. A retry keeps its normalized payload
  and ID; a different action gets a new ID. Cookie-authenticated identity and
  destination scope are required for deduplication; UUID shape is not proof.
- Results carry the original `processedRevision` and latest `currentRevision`,
  with processed <= current. Replaying a stored outcome may set `duplicate: true`
  while current state has advanced. The outcome never edits robots or scores.
- Revision counts committed public state changes, not countdown ticks. It stays
  monotonic across a room restart/rematch, is scoped to room ID, and is not reset
  when a new match starts. New room IDs establish a different revision scope.
- Reads/no-ops/rejections need not change state. Due deadline expiry may do so
  independently, including before rejecting a late bid, stale action or ID conflict.
  The handler must preserve that newer state and send a current snapshot.
- Authenticate/validate first, then look up the ID in its private destination
  scope before executing it as new. Same ID + same normalized request replays the
  recorded outcome without re-running moves/scoring. Conflicting reuse rejects
  without overwriting the record. Due expiry is still normalized on retries;
  state/result/revision must be persisted consistently before acknowledgment.
- A sender receives its private result and a current snapshot; public changes are
  broadcast. Older snapshots must not overwrite newer state in the same room;
  equal revision means equal state even if `serverTimeMs` differs. Equal revision
  with different state requires resync, not a merge. Apply full snapshots, not
  optimistic result-derived state changes.
- Match/round/attempt/lobby IDs prevent delayed requests crossing contexts. Exact
  attempt version protects corrections within an attempt. These are later
  handler checks, not guesses from a response ID or a universal exact room-revision
  precondition that would unfairly reject competing bids.

Membership replies check seat membership and room identity against their full
snapshot. A retried create reply can contain a newer active match; it is not
forced to show a stale lobby. Reconnect privately rebinds the same seat and sends
current state, never solver/history replay or nickname-based identity recovery.

Parsing is deliberately stateless. It validates fields/reason codes/revision order,
not correspondence to a pending request, delivery order, original payload equality,
authorization, durable replay records, actual clocks or session validity. Contract
tests illustrate original/retry/conflict/expiry/stale/rematch scenarios but do not
implement those policies. Server-only timer/preparation operations remain invalid
client requests. T14–T18 still implement authentication, handlers, persistence,
snapshot reconciliation and reconnection; this package sends no network traffic.

## T14 integration handoff

Example player request (fake UUIDs):

```json
{
  "version": 1,
  "commandId": "c0000000-0000-4000-8000-000000000001",
  "roomId": "10000000-0000-4000-8000-000000000001",
  "context": { "lobbyId": "20000000-0000-4000-8000-000000000001" },
  "command": { "type": "board.shuffle" }
}
```

Successful parsing does not mean the sender is host, the lobby still exists,
the cookie is valid, or that a duplicate may be executed again.

| Later task | Responsibility not implemented by shared |
| --- | --- |
| T14 | Same-origin bootstrap/room routes, secure local test setup, cookie issuance/verification, seat membership, room codes, authenticated sockets, Origin/raw-byte/rate controls, host shuffle/start, and bootstrap/lobby replay persistence |
| T15 | Trusted host/actor/time context, match creation/preparation, server deadline alarms, contextual action checks, atomic bids/expiry, persistent revisions/outcomes |
| T16 | Authoritative attempts/scoring and metadata versions, stale-attempt rejection, safe command retries, broadcasts and client snapshot reconciliation |
| T17 | Reconnection/seat continuity, credential/session validity on long-lived sockets, multi-tab policy, bidder grace/confirmed skip, fixed host (no transfer), guest Leave/host End Room, empty-room expiry; see T17 design gates |
| T18 | Actual multi-browser/multi-device, restart/retry/disconnect verification |

Before T14 implementation, settle credential lifetime/rotation/revocation and
storage, room-code routing/collision handling, room/session/command atomic storage
boundaries, replay record retention/capacity, and secure mobile local testing.
Use the already approved cookie and protocol design; review changes to it rather
than quietly switching to nickname authentication or exposing tokens in URLs.
No account system, external database, or additional infrastructure is approved
by this handoff. Choose the smallest Worker/Durable Object arrangement needed.

Before live T15 preparation, review solver resource suitability in the server
runtime and unsuccessful-selection recovery. Shared preparation status does not
authorize automatic retry/reset/board substitution or guarantee ten-target supply.
T17's gameplay/fairness policies need approval before implementing those handlers.

T15.2 adds the reviewed `preparation.retry` room request. Its exact context is
`{ matchId, preparationId }` (both UUIDs), and its command has only `type`.
Deferred/error Preparing snapshots may include
`preparation.retry: { preparationId, availableAtMs }`. This is safe public
eligibility/cooldown metadata, not a credential or permission grant. Working and
unavailable snapshots cannot advertise Retry. Existing status-only snapshots
remain valid. The server checks the current job, host, phase and five-second
cooldown, returning `preparation-cooldown` when too early. New command IDs are
needed for new attempts; exact retries retain their original outcome, including
an earlier rejection. No client budgets, candidate orders, targets or proofs are
accepted. Protocol version remains 1; the extension is covered by strict parsers
and public allowlist projection. Runtime scheduling/persistence stay server-owned.

T17.4 extends current v2 Demonstrating snapshots with optional-for-retained-data
`disconnect: null | { disconnectId, disconnectedAtMs, skipAllowedAtMs, status }`.
Status is `grace | skippable`; the deadline is exactly 60 seconds after the
server-recorded effective absence, and non-null metadata requires an offline
active bidder. New server snapshots normalize this field; missing legacy metadata
never grants permission. Other phases reject it. The corresponding host command
is `attempt.skipDisconnected` with `{ confirmed: boolean }` and exact context
`{ matchId, roundNumber, attemptId, attemptVersion, disconnectId }`. Server-owned
authorization returns `bidder-connected`, `disconnect-grace-active`, or existing
context/host/confirmation errors. Time, presence, eligibility and acceptance are
never trusted from a client countdown. The pure controller's abandonment action
is not a wire/player command; v1 receipt wrappers cannot introduce this v2 action.
Update the backend and reload frontend tabs together during local testing.

T17.6 adds `room.end` (`confirmed: boolean`) bound to exactly one current lobbyId
or matchId. It is server-authenticated/host-only, not a pure match/player action.
Closed notifications include `host-ended`; command/bootstrap rejections include
`room-closed` and `room-expired` (empty expiry implemented by T17.7).
Historical v1 receipt wrappers cannot introduce End. A closed room never reopens
to execute a missing request. Authenticated same-origin POST to
`/api/rooms/:roomId/retry` accepts an original bounded room envelope for private
lookup only; it can return retained `command.result` without a playable snapshot
or WSS binding. Cookie/membership/rate validation remains the server's job.

T17.7 uses existing v2 `room.closed` reason `expired` and `room-expired`
bootstrap/command rejection. No empty-room deadline or credential is exposed.
Server-persisted 30-minute emptiness is canceled only by an authenticated live
binding before expiry, not HTTP lookups or stale traffic. End and expiry reuse
terminal receipt lookup, directory invalidation and retained tombstones; neither
fabricates Finished or changes scores. Guest Leave remains tab-local and sends
no room-membership command. T17.8 verifies the assembled runtime/client behavior;
this shared package still performs no authentication, network I/O or storage.

T13.5 verification: 378 shared / 922 workspace tests passed, workspace type checks
and production build passed. Existing adversarial boundary/privacy/size tests were
reused; two added deterministic contract scripts cover two-/six-player ten-round
matches through both request/reply parsers, including corrections, rollback,
successful carry-forward, positive ties, skip/exhaustion, resume-shaped replies,
and lobby return. All-zero results remain covered by the phase tests. The source
and six-package dependency audit found no cycle or shared runtime platform/solver
import. These are contract/engine tests, not authentication or browser E2E tests.
