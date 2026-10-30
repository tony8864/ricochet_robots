# T14 — Room Creation, Seats, and Invite Flow

## Status and completion boundary

Complete through T14.9 on 2026-10-30: persistent identity/rooms, real Create/Join,
connected lobby, host Shuffle, authoritative Start/room lock and initial Preparing.
The owner confirmed the guided PC/Android checks; 1,152 workspace tests, type
checks, production build and whitespace checks passed. See
[T14.9](T14-9-final-verification.md) for exact evidence and remaining limitations.
Wi-Fi-loss detection/automatic recovery are not fully passing and remain T17
work. T14 does not enable a playable full networked match; T15/T16 remain pending.

Read `AGENTS.md`, `docs/product.md`, `docs/architecture.md`,
`packages/shared/README.md`, the approved T13.1 design, and the selected subtask.
Implement one explicitly requested checkpoint at a time; creating these task
documents does not authorize implementation, installation, trust changes or deploy.

## Decisions agreed with the owner

- Browser identity has a fixed **24-hour lifetime from server issuance**.
  Refresh, resume, reconnect and ordinary activity do not extend it. Server and
  cookie expiration agree; invalid/expired credentials cannot reclaim a seat.
  Credential lifetime is not room lifetime or disconnect grace.
- Use one small shared registry plus one Durable Object per room. The registry
  owns session verification records, code-to-room lookup and create reservations/
  replay bookkeeping. Each room owns its roster/host/board/revision and room-local
  replay records, with game state added at later checkpoints.
- Use built-in persistent Durable Object storage, not an external database or
  an in-memory-only registry. Distinct objects do not share one atomic transaction;
  creation needs recoverable, idempotent coordination.
- Preserve T13's same-origin HTTPS bootstrap + WSS, private HttpOnly/Secure/
  SameSite=Lax host-only cookie, public snapshots and exact validation contracts.
- Plan local testing using PC browser plus the owner's Android phone on Wi-Fi.
  Local HTTPS is the proposed testing approach; certificate generation/trust
  installation must be explained and separately authorized. Do not install a
  trust root, modify firewall rules, create a tunnel or deploy automatically.
  The friend's iPhone need not be involved in development certificate setup.

The owner subsequently approved T14.1's concrete storage/recovery/resource and
local-setup design. Those decisions are recorded there; implementation now covers
scaffolding, identity, creation, membership and live lobby. Certificate trust remains separately
permission-gated.

## Initial ordered subtasks

- [x] [T14.1 — Server design and local development setup](T14-1-server-design-and-local-setup.md)
- [x] [T14.2 — Fixed-lifetime browser identity](T14-2-browser-session-identity.md)
- [x] [T14.3 — Registry-backed room creation](T14-3-room-registry-and-creation.md)
- [x] [T14.4 — Join rooms and resume existing seats](T14-4-room-join-and-seat-resume.md)
- [x] [T14.5 — Authenticated live lobby connections](T14-5-authenticated-live-lobby.md)

Implementation and verification records are linked above. T14.9 supersedes older
pending browser/device status notes without claiming full automatic recovery.

## Product UI and remaining checkpoints

6. [T14.6 — Create and join room UI](T14-6-create-and-join-room-ui.md): implemented;
   Create/Join confirmed working by the owner between PC and phone; no Act as in
   authenticated mode. Verification recorded in T14.9.
7. [T14.7 — Connected lobby UI](T14-7-connected-lobby-ui.md): implemented;
   shared board/roster/actions, top-right room code/Copy, live connection feedback
   and server-authoritative host shuffle. Owner multi-device checks recorded in T14.9.
8. [T14.8 — Start Match and room locking](T14-8-start-match-and-room-locking.md):
   implemented; host Start locks board/roster and enters persisted Preparing.
   Existing seats can resume; new joins are rejected. Owner device checks passed.
   Target selection/bidding are T15.
9. [T14.9 — Final T14 verification](T14-9-final-verification.md): complete with
   known T17 disconnect/recovery limitations; actual PC/Android results, automated
   retries/permissions/capacity/persistence evidence and remaining scope recorded.

All nine checkpoints are documented. No T15 implementation is implied.
Server-side `board.shuffle` is part of T14.5
so live board synchronization is testable; wiring its product button is step 7.
Live `room.start` is step 8, not an implicit addition to steps 1–5. Join-policy
tests may seed a valid locked-room fixture before then; do not create a public
test backdoor that starts or unlocks matches.

## Boundaries and correctness

1. Reuse T13 parsers/projection and existing catalog/engine contracts. Validate
   HTTP/WS inputs at the server boundary and separately authenticate/authorize.
   No client-supplied host, seat, clock, board geometry or score is authority.
2. Preserve 1–6 seats in a lobby, 2–6 to start, and duplicate nicknames. Session
   membership identifies seats; names/codes alone cannot resume another player.
3. Persist essential state, public revisions, creation reservations and outcomes
   consistently before acknowledging. Lost replies/restarts must not create
   duplicate rooms/seats or replay a shuffle. Never silently evict replay records
   and interpret an old command ID as a new action.
4. Registry and room creation/recovery must be documented/tested across partial
   failures. Do not assume cross-object calls form one transaction. Server-private
   verifiers/records never enter snapshots, logs or protocol error payloads.
5. Authenticate Origin/session before upgrade. Enforce raw-size, content-type,
   validation and resource protections at the correct boundary. Cookies, UUIDs
   and successful parsing do not prove membership or host permissions.
6. Connections carry trusted server bindings. Do not broadcast private membership
   replies; only approved public message types reach room-wide recipients.
   Track connection changes from real connections, not stale persisted flags.
7. Fail closed on unimplemented commands without running match actions. Document
   checkpoint limitations; do not invent new T13 commands/error codes silently.
8. Keep the existing local simulator usable and separate. No broad UI rewrite,
   new game rules, external database, public hosting, bidding/demo integration,
   solver runtime work or host-transfer/abandoned-attempt policy in steps 1–5.

## Verification and completion gate for step 5

Add focused tests per checkpoint with controlled clocks and injected failures,
plus actual Worker/Durable Object integration tests where boundaries require it.
No real-time sleeps to test 24-hour expiration. Run relevant tests/type checks,
then workspace tests/type checks/build/whitespace checks at integration checkpoints.
Record commands, counts, actual browser/device checks and anything unavailable.

The initial goal is met when distinct authenticated browsers can create/join one
room, see the same roster/board/revisions, receive host-only shuffle changes,
and explicitly resume without allocating another seat. Unauthorized/expired
sessions and unsafe retries must fail correctly. A minimal same-origin console/
tool harness is sufficient; normal create/join screens are not required yet.
Do not claim mobile recovery/host continuity or complete T14 from this gate.

No commit, deployment, real trust installation, or later-task work without a
separate request/approval. After T14.5, stop and review with the owner.
