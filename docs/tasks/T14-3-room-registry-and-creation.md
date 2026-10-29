# T14.3 — Registry-Backed Room Creation

## Status and dependency

Implemented after [T14.2](T14-2-browser-session-identity.md).
HTTPS/browser-cookie/device checks remain pending the separate certificate setup.
Follow the [parent](T14-room-creation-seats-and-invite-flow.md) and reviewed T14.1
storage/recovery design. Create persistent lobbies, not live matches.

## Work

1. Implement authenticated `POST /api/rooms` for `room.create`, binding the request
   to the verified browser session, never a caller-supplied host/seat assertion.
2. Reserve a unique canonical six-character code from T13's alphabet. Allocate
   fresh canonical room/seat/lobby IDs and select a server-owned valid catalog
   board. Code collisions retry within reviewed bounds; never overwrite a room.
3. Persist creation reservation/replay context in the registry; initialize exactly
   one Room object with one host seat, chosen board and initial public revision.
   Publish a mapping/reply only when initialization is valid/recoverable according
   to the reviewed coordination plan. No cross-object atomicity assumption.
4. Keep session-to-seat binding private in room state; snapshots expose only the
   public roster/host/board. Use `projectLobbyState` and private `room.entered`
   with membership `created`; credential stays in its existing HttpOnly cookie.
5. Scope command IDs/canonical requests to authenticated identity/destination.
   Same ID/payload returns the same creation, not another room; conflicting reuse
   fails without replacing the original record. Unrelated sessions cannot obtain
   a cached room/seat by guessing an ID.
6. Implement bounded private recovery for partial creation consistent with T14.1.
   Persist essential records before acknowledgment. No destructive automatic
   cleanup of active rooms or unchecked replay-record eviction.

## Tests and acceptance

- One browser creates a room; public snapshot validates with exactly one host,
  one seat and a complete catalog board, no active target/match or credentials.
- Concurrent/retried identical create requests yield one room/code/host seat.
  Payload conflicts, unauthenticated calls and invalid Origins/bodies fail safely.
- Inject code collisions and failures before/after reservation, object init,
  mapping publication and reply. Retry/restart recovers the same logical creation
  without double allocation or a permanently published uninitialized room.
- Registry and room state survive instance restarts using real runtime storage
  tests, not just in-memory mocks. Verify reviewed capacity/failure behavior.
- Cookie/session/room records are private; snapshots/errors/logging do not leak
  tokens, verifiers, stored requests or recovery internals.

Document a same-origin browser-console/tool recipe using automatic cookies, never
instructions to copy raw credentials into URLs/logs. Run focused/integration tests,
type checks and proportionate workspace checks. No join, sockets, shuffle/start,
gameplay, finished product UI, deploy or commit yet. Stop before T14.4.

## Implementation record

- `POST /api/rooms` validates the same exact HTTPS Origin/content type/bounded
  body as session bootstrap, then authenticates the existing cookie in Registry.
  Missing, unknown, expired, revoked or ambiguous credentials cannot allocate a
  room. The route does not issue or renew cookies. Shared validation rejects
  client-supplied identity, board geometry, host flags and other unknown fields.
- Registry uses one `room_creations` row per authenticated session/command ID.
  It stores the canonical normalized request, room/code/lobby/host IDs and a copy
  of the selected complete catalog board. This preserves initialization data
  across restarts/catalog edits. Pending reservations also reserve their codes.
- Reservation, budget updates and publication are object-local SQLite writes.
  Room initialization is a separate RPC and its own SQLite transaction. It creates
  one host membership and revision-1 lobby; identical initialization reads current
  state, conflicting initialization fails without overwriting anything. No
  cross-object transaction or exactly-once network delivery is assumed.
- The host is initially `connected: false`: an HTTP membership is not a live
  socket. Actual connection tracking arrives in T14.5. Public state is produced by
  `projectLobbyState`; the private session-to-seat mapping is stored separately.
  Only `room.entered` with the public snapshot reaches the authenticated caller.
- The pending/published status is also the code-publication gate; no second mapping
  table can drift out of sync. Pending lookups expose no room ID. Same scoped ID
  and normalized payload recover the same room/seat/code; different payloads get
  `command-id-conflict`. Another session's identical command ID is a separate scope.
- Code generation uses the T13 alphabet with at most 8 collision attempts. The
  approved limits include 1,000 total reservations, 20 creations per session,
  5 create attempts/minute and the shared 30-bootstrap-attempts/minute counter.
  Retries consume request budget but not additional room capacity. Existing records
  remain replayable at room capacity; old replay records/rooms are never evicted.
  Bounded cleanup only reclaims obsolete private rate counters of expired owners.
- Before calling Room, Registry schedules recovery. On cold construction, pending
  work re-establishes its alarm. Maintenance processes at most 10 due reservations;
  failed ones are deferred 60 seconds so they cannot monopolize the batch. Client
  retries can recover immediately without waiting for maintenance. Recovery uses
  durable, previously authorized reservations, never a caller-supplied host identity.
  No public recovery/reset/seed endpoint exists. Storage failures fail closed;
  recovery cannot promise availability while the underlying storage is unavailable.
- RPC results are explicitly disposed. Cloudflare's transport-only disposer is
  removed by copying JSON data before strict snapshot parsing, not by loosening
  shared public validation. HTTP replies retain T13's 64 KiB size bound. Session
  validity is rechecked after initialization before returning private membership.

Tests exercise concurrent/reordered/normalized retries, conflicts and session
isolation, transport/auth/privacy checks, collision exhaustion, personal/global
capacity, interrupted reservation/init/publication/reply, current-state reads and
alarm recovery. Real runtime shutdown/recreation preserves a published room and
recovers both a merely reserved room and one initialized before publication.
The test-only reservation path is bundled only in the persistence fixture, never
in the Worker entry. No real-time sleep or production seed hook is used.

Browser-console instructions are in [local development](../local-development.md).
No new product/game rule, UI, join/start/socket handler, deployment or commit is
included. The existing pinned-toolchain/Windows temporary-cleanup warning remains.

Verification on 2026-10-28: all 87 server tests / 1,008 workspace tests passed;
workspace type checks and production web build passed. Header/runtime checks do
not replace pending real HTTPS/browser-cookie/Android verification. No new game
rule or architecture deviation beyond the approved Registry/Room design.
