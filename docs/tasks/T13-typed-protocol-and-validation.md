# T13 — Typed Protocol and Runtime Validation

## Status and goal

Complete for the approved protocol-only scope on 2026-10-27. T13.1 was approved
and T13.2–T13.4 implemented on 2026-10-26; T13.5 audit/handoff is complete.
This parent and its five
subtasks were requested after the local T12 UI was built and the restored
10-round / 60-second workspace passed 545 tests, type checks, and build.
Older T12 status text still needs separate reconciliation; this task does not
claim that every browser/E2E check has been completed.

Define the small, runtime-validated language that clients and the future server
will share. Derive messages from the existing lobby UI, T11 match contracts, and
T12 interactions rather than designing a general networking framework.

Read `AGENTS.md`, `docs/product.md`, `docs/architecture.md`,
`packages/match/README.md`, and the selected subtask before implementation.
Work on one explicitly requested subtask at a time. Creating these documents
does not authorize implementing T13 or starting T14.

## Scope and boundaries

- Implement shared TypeScript contracts, pure parsing/validation, explicit public
  snapshot projection, and contract tests in `packages/shared`.
- Reuse public engine/match types and validators when appropriate, without
  exporting the internal match action envelope as the network protocol.
- Distinguish untrusted requests, private seat/session replies, public room
  snapshots, and trusted server-only operations.
- Specify command correlation, protocol versioning, revision ordering, and stale
  action/retry semantics. Actual authorization, deduplication, persistence, and
  transport enforcement belong to later server/client tasks.
- Recommend full authoritative snapshots initially. Confirm their exact shape
  and transport boundaries in T13.1 before treating this as an approved design.
- Keep shared runtime code independent of React, Cloudflare, sockets, clocks,
  storage, and platform-specific globals. Do not create reverse dependencies
  from engine/match into shared or introduce package cycles.
- Prefer existing dependencies and simple explicit validators. A new schema
  library requires a demonstrated need and approval, not an automatic addition.

## Ordered subtasks

- [x] [T13.1 — Message inventory and protocol design](T13-1-message-inventory-and-protocol-design.md) — owner approved 2026-10-26
- [x] [T13.2 — Client request contracts and validation](T13-2-client-request-contracts-and-validation.md) — 185 shared tests; workspace checks pass
- [x] [T13.3 — Public snapshots and safe projection](T13-3-public-snapshots-and-safe-projection.md) — definition reviewed/implementation authorized; 58 new snapshot tests, 243 shared total
- [x] [T13.4 — Server replies, revisions, and private session contracts](T13-4-server-replies-and-revision-contracts.md) — 133 new reply tests; 376 shared / 920 workspace tests passed
- [x] [T13.5 — Protocol verification and integration handoff](T13-5-protocol-verification-and-handoff.md) — 378 shared / 922 workspace tests; checks and handoff complete

T13.1 is a design checkpoint requiring owner review before schema implementation.
The following four tasks implement only the reviewed design, with focused tests
at each checkpoint. A change affecting security, architecture, or gameplay must
return to review rather than silently expanding that design.

## Rules the protocol must preserve

1. Credentials authenticate a seat; a nickname, public seat ID, or room code
   alone does not. Clients cannot assign host identity, server time, scores,
   robot positions, accepted bid order, or a successful result.
2. Clients request player actions. The server constructs trusted context and
   calls T11. Timer expiry and verified preparation are server operations.
   Continue is a host request, not permission to send arbitrary controller actions.
3. Ordinary bids remain positive safe integers as supported by the existing
   model. Higher competing bids are legal; only one's own bid cannot increase.
   Do not invent a lower maximum bid as an incidental schema constraint.
4. Lobby capacity is 1–6 seats; starting a match requires 2–6. No new seats may
   join a started match, while authenticated existing seats may reconnect.
5. The server owns the one 60-second bidding deadline and all accepted state.
   A client cannot start/extend a deadline using its timestamp.
6. Rejected commands can still accompany a newer state after independently due
   deadline expiry. An acknowledgment is not a substitute for a state snapshot.
7. Credentials, credential hashes, solver proofs, unrevealed selections, and
   private preparation input must never appear in broadcast snapshots/errors.
8. The reviewed New Match action is host-only and returns to the lobby with the
   same players/host; starting the next match remains a separate action.
   The all-zero "No winner" result is a UI presentation distinction, not a change
   to the existing model's shared-winner/scoring rules.

## Decisions for T13.1, not assumptions in this task

- Exact request/reply names, version/envelope shape, and public snapshot fields.
- Nickname rules, room-code format/normalization, identifier lengths, collection
  bounds, and maximum encoded message sizes, including string/byte semantics.
- Private credential delivery/reconnect contract and its transport constraints.
- Board identity/version versus geometry in snapshots; phase-appropriate attempt
  data versus server-only undo history; safe preparation feedback.
- Per-command match/round/attempt context and revision policy for stale actions.
  Do not reject otherwise valid competing bids merely because another player's
  action advanced the room revision.
- Response and revision behavior for accepted/no-op/rejected commands, repeated
  IDs, conflicting payloads under one ID, and responses after a rematch.

Leave unresolved departure/grace/host-transfer policies for T17. Live solver
runtime and unsuccessful-preparation recovery require review before T15 live
integration; a network message must not silently approve a recovery policy.

## Verification and completion

Run focused shared tests/type checks per implementation task. At completion run
workspace tests, workspace type checks, production build, and whitespace checks,
including newly added files. Record actual results and limitations.

Complete when all reviewed messages have runtime validators, public projection
cannot leak private data, tests cover the lifecycle and hostile inputs, and T14
has a precise integration contract. Protocol tests alone do not prove identity,
retry safety, room durability, reconnection, solver runtime, or synchronization.

## Exclusions

No Worker/Durable Object, routes, WebSockets, room creation implementation,
credential generation/storage, server timers, database, deployment, UI changes,
client network adapter, or new gameplay rules. Do not modify T12 implementation,
mark later tasks complete, commit, or start T14 automatically.

## T13.2 checkpoint — 2026-10-26

Implemented the 15 approved client request variants, distinct bootstrap/room
envelopes, exact contextual shapes, and strict pure object/JSON parsers in
`packages/shared`. Normalization is limited to reviewed nickname/code rules;
errors never echo payloads. The JSON entry point checks UTF-8 bytes before
parsing without a platform encoder. Added workspace-only engine/match dependencies
for enum and domain-type reuse; no external library was introduced.

Verification: 185 shared tests, 729 total workspace tests, workspace type checks,
production build, and offline frozen installation passed. Documentation links
and whitespace are checked separately. No UI/server implementation changed.
At this historical checkpoint, T13.3/T13.4 were pending; the next entry records
T13.3 completion. Server responses still remain T13.4.

## T13.3 checkpoint — 2026-10-26

Implemented reviewed public room/match types, safe projection and strict nested
validation for lobby/all six phases. Metadata binding prevents projecting an old
attempt into a current bidder; preparation maps pending/failed/idle activity
explicitly; coordinate checks verify success without solver calls. Output is
owned and private nested fields are omitted. Existing puzzle validation is reused
through a workspace dependency; no external dependency or reverse package edge.

All 243 shared / 787 workspace tests, workspace type checks, production build,
and offline frozen installation passed. Snapshot fixtures include every catalog
board and the densest legal 468-wall geometry with maximum-length Unicode fields,
within the approved 65,536-byte envelope cap. T13.4 will implement those envelopes
and raw-byte limits; no server, UI, deployment, or network verification is claimed.

## T13.4 checkpoint — 2026-10-26

Implemented all eight approved server-message variants, separate public/private
unions, safe outcome/error vocabularies, and pure object/JSON/broadcast-boundary
parsers. Nested state uses T13.3 validation; private seat/room binding and safe
processed/current revision ordering are checked. Encoded server JSON is limited
to 65,536 UTF-8 bytes before parsing; future transport still bounds raw frames.

All 376 shared / 920 workspace tests, workspace type checks, production build,
and whitespace/documentation checks passed. Contract tests cover safe failures,
membership/resume, retries/conflicts/expiry/stale actions and ordering scopes,
without implementing server persistence, network delivery or reconciliation.
T13.5 final audit/handoff remains pending; T14 was not started.

## T13.5 / T13 completion — 2026-10-27

Audited all approved requests/replies, public/private projection, strict runtime
validation and bounded parsing against existing tests. No runtime fix or protocol
change was needed. Added two deterministic cross-contract scripts for two-/six-
player ten-round matches through real T11/T10 and both JSON parsing directions.
Reused existing malformed-data/privacy/UTF-8/phase/boundary coverage.

All 378 shared / 922 workspace tests, workspace type checks and production build
passed. Six workspace dependency manifests were audited as acyclic and shared
runtime source has no platform/network/timer/storage/solver import. Documentation
links and whitespace were checked. Shared README records concrete T14 integration
responsibilities and still-unresolved session/storage/runtime/lifecycle policies.

This completes protocol contracts, not authoritative multiplayer, authentication,
durability, duplicate handling, client reconciliation, or browser reconnection.
No server/UI implementation, deployment or commit was added. Discuss/request T14
separately before beginning it.
