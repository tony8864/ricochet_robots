# T13.4 — Server Replies, Revisions, and Private Session Contracts

## Status and dependency

Implemented and verified after [T13.3](T13-3-public-snapshots-and-safe-projection.md)
on 2026-10-26. Full verification results are recorded below.
Read the [parent](T13-typed-protocol-and-validation.md) and approved protocol design.
Complete the server-to-client contracts without implementing a running server.

## Work

1. Define and validate snapshot messages, command accepted/no-op/rejected replies,
   and only the reviewed lifecycle/error messages. Reuse the T13.3 public snapshot
   and reviewed public rejection mapping instead of leaking internal errors.
2. Define the separate private create/join/resume response or bootstrap/session
   contract from T13.1. Credential-bearing values are recipient-only, never part
   of a broadcast union/projection. Do not generate, verify, store, or log tokens.
3. Implement pure server-message parsing with protocol version, command correlation,
   room/match identity, safe revisions, authoritative time, and nested validation.
   Do not merge private membership responses with ordinary shared snapshots.
4. Document precise revision and delivery semantics from the reviewed design:
   - revisions identify authoritative room state, not local animation/time ticks;
   - a no-op need not change state; deadline normalization can independently do so;
   - a rejected late request can accompany a newer authoritative snapshot;
   - an acknowledgment alone cannot be applied as a robot/score update;
   - older snapshots must not overwrite newer state in the same revision scope;
   - rematches and different rooms must not confuse state/action identities.
5. Document ID retry/conflict and stale match/round/attempt rules for later server
   handlers, including their order relative to due deadline normalization. Specify
   how a retried response relates to current state without promising that a simple
   string ID or validator implements idempotency.
6. Keep server-only preparation and timer operations unavailable as client request
   variants. A public host Continue request is checked by the later room handler
   before translating to trusted model advancement.

## Tests and acceptance

- Every reviewed server reply validates and JSON-round-trips, including no-op,
  rejection with current state, private seat establishment, and reconnect state.
- Reject malformed/unknown replies, impossible envelope fields, bad revisions or
  timestamps, and invalid nested snapshots using the approved structural rules.
- Private values never appear in serialized public messages or parser errors.
- Table-driven contract examples cover duplicate IDs, conflicting ID reuse,
  stale actions, out-of-order snapshots, and a new match in the same room.
  Tests illustrate the contract; actual storage/delivery/deduplication remain
  explicitly unimplemented until the server tasks.
- No parser trusts a client-supplied clock, seat/host assertion, or result to
  establish authority. Public and private message boundaries are explicit.

Run shared tests and type checks. Do not add a Worker, connection manager,
authentication/session mechanism, client network controller, alarm, or storage.

## Implementation

`packages/shared/src/serverMessages.ts` defines all eight reviewed readonly reply
variants, public outcome/error vocabularies, and separate public/private unions.
Only `room.snapshot` and `room.closed` are room broadcasts. Recipient bindings,
membership replies, command results, bootstrap failures, and protocol errors are
private. The approved cookie design never places raw credentials in JSON.

`parseServerMessage`, `parseServerMessageJson`, and `parsePublicServerMessage`
validate exact fields, safe times/IDs/revisions, reviewed codes and nested T13.3
snapshots. Private seat bindings must match both room and roster in their state.
Processed revision cannot exceed current revision. The JSON API checks the total
65,536-byte UTF-8 limit before parsing without DOM/Node encoders. Unknown/private
fields, getters and malformed values fail with bounded codes, never payloads or
exception text. Parsed output owns nested objects rather than retaining input.

Shared README records authentication/deduplication/normalization ordering,
original versus current revisions, correlation/ID-conflict behavior, stale
context, room-scoped ordering across rematches, and private binding on reconnect.
Actual server state, retries, persistence, clocks and client reconciliation
remain integration tasks; the parsers are stateless contract checks only.

`serverMessages.test.ts` adds 133 tests: every message and public reason,
round-tripping, exact fields, version/time/revision boundaries, private/public
separation, nested state and room/seat consistency, safe errors, UTF-8 limits,
and controlled contract examples for retry/conflict/late/stale/out-of-order and
return-to-lobby scenarios. An engine-backed active-attempt fixture verifies
private resume replies, including a late creation reply with newer state.
No external dependency, gameplay/UI/server implementation, or commit was added.

Verification: all 376 shared / 920 workspace tests passed, as did workspace type
checks, production build, whitespace checks and local documentation links.
T13.5 final protocol verification/handoff remains pending. No two-browser,
network authentication, retry persistence, or actual reconnect test is claimed.
