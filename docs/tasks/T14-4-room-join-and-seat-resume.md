# T14.4 — Join Rooms and Resume Existing Seats

## Status and dependency

Implemented after [T14.3](T14-3-room-registry-and-creation.md).
Real HTTPS/browser-cookie/device verification remains pending certificate setup.
Follow the [parent](T14-room-creation-seats-and-invite-flow.md). Add authenticated
membership and explicit snapshot resume, not WebSocket reconnection orchestration.

## Work

1. Implement `POST /api/rooms/join` with T13 `room.join`: authenticate browser
   session, normalize/validate request, resolve code through registry, and let
   the Room object atomically decide membership/capacity/current phase.
2. A new browser may create one seat only in a lobby with fewer than six seats.
   Keep stable roster order and duplicate nicknames legal. Joining cannot change
   the existing host or caller-select an identity/role.
3. An existing authenticated member returns their original seat without another
   allocation or nickname change, even when the room is full or match started.
   Matching nickname/code without the private session binding grants no access.
4. Implement `POST /api/rooms/{roomId}/resume` with `session.resume`. Route/body
   room ID must agree, identity must already own a seat, and the private reply
   includes that seat and a freshly projected authoritative snapshot. Resume
   never creates a room, new seat, match or new session lifetime.
5. Persist membership/revision/replay outcome consistently before success.
   Concurrent duplicate requests/lost replies cannot create extra seats or lose
   an accepted membership; conflicting command-ID reuse is rejected safely.
6. Use current T13 private reply/rejection shapes and reviewed protection limits.
   Unauthenticated callers do not receive room-existence/private-state details.
   Expired identities cannot recover a seat by name or reusing a public seat ID.

## Tests and acceptance

- Two distinct cookie jars join one room and receive correct private identities
  and the same public roster/board. Room code case normalization is preserved.
- Concurrent joins at five seats allow only one new sixth seat. Seventh new
  sessions fail; existing members still resume in a full room.
- Duplicate requests/restarts preserve one seat; payload conflicts and unrelated
  sessions cannot replay another seat's response or impersonate the host.
- Wrong code, mismatched route/body ID, missing/expired/revoked cookie, nonexistent
  membership, malformed/oversized input and disallowed Origin are safely rejected.
- A trusted seeded locked-match fixture rejects a new member but permits an
  existing member. This tests the policy without implementing live Start early
  or introducing a public test-only lock/unlock endpoint.
- Resume after room/registry restart reconstructs stored authoritative state;
  local browser state and stale cached membership replies are not the source.

Run focused server/runtime integration tests and type checks, plus appropriate
workspace checks. Document console/tool recipes; do not build create/join screens
or expose cookies in a harness. Automatic reconnect/backoff, host transfer,
credential-loss recovery and abandoned-attempt rules remain later tasks.

## Implementation record

- Added join and route-bound resume handlers using the existing shared bootstrap
  method/Origin/content-type/raw-body/parser checks. Route/body UUID mismatch and
  wrong commands fail before any membership action. Cookies are never issued or
  renewed here; malformed/ambiguous/missing credentials cannot grant membership.
- Registry authenticates before resolving codes/room UUIDs, applies the shared
  durable 30-bootstrap-request/minute budget and forwards only trusted session
  context to Room. Creation still has its separate 5/minute limit. Unknown room
  UUIDs never cause a Room object to be initialized; pending mappings return
  `temporarily-unavailable` rather than exposing a partially initialized lobby.
- Room owns the SQLite transaction for membership, public revision and replay
  outcome. New seats append to the roster only in an unlocked lobby below six
  players; the host never changes. Duplicate nicknames are legal. A real new seat
  increments revision once, while resume/rejoin/replay do not. Initial connection
  flags remain false until actual sockets exist in T14.5.
- Existing private session membership is checked before phase/capacity. A fresh
  rejoin returns `resumed` with the original seat/nickname, even after room lock or
  at capacity. Explicit resume only reads an existing member; it cannot allocate
  a seat. Matching nickname, public seat ID or code is not identity proof.
- Room-local replay keys are `(sessionId, commandId)` and compare canonical
  normalized commands. Join and resume share that namespace. Accepted retries
  retain their original membership/seat and processed revision, but return the
  latest authoritative public snapshot. Domain rejection outcomes are also
  retained; changing the payload under an existing ID conflicts. Different
  sessions cannot replay each other's membership.
- The private replay ledger retains records for the room lifetime, with the
  approved 100,000-per-room / 10,000-per-session-per-room caps. It checks known IDs
  before capacity, so existing retries still work at exhaustion. Resource failures
  do not evict old records. Future room commands must share the same replay
  namespace/capacity accounting, not silently introduce an independent allowance.
- Public snapshots are freshly projected/validated from stored authoritative
  state. Private mappings, credentials, verifiers, stored requests and outcomes
  are not reply fields. Session validity is rechecked after the Room RPC before
  disclosing private membership. Unexpected failures produce bounded T13 replies.

Tests cover two identities, normalized codes/names, current snapshots on replay,
duplicate/conflicting IDs, stable names/host/order, the concurrent sixth-seat race,
full-room existing membership, recorded rejections, auth/transport/size safeguards,
pending/unknown room behavior, rate/replay caps and atomic rollback on an injected
ledger failure. A trusted seeded Preparing snapshot tests match locking without
adding a Start/lock endpoint. Full runtime shutdown/recreation preserves joined
seats and both join/resume replay records, alongside existing creation recovery.

Verification on 2026-10-28: all 106 server / 1,027 workspace tests, workspace type
checks and production build passed. The documented Windows temporary-directory
cleanup warning remains non-blocking. Real browser-cookie/Android checks are not
claimed. No UI, sockets, host-transfer, gameplay, deployment or commit was added.
See [local development](../local-development.md) for same-origin console recipes.
