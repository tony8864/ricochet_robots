# T14.5 — Authenticated Live Lobby Connections

## Status and goal

Server implementation/runtime verification complete after
[T14.4](T14-4-room-join-and-seat-resume.md). Real HTTPS browser-profile/Android
verification remains pending certificate setup and owner review.
This is the owner's current target checkpoint in
[T14](T14-room-creation-seats-and-invite-flow.md): two independent browsers
receive synchronized room roster and selected board through real authenticated
connections. It is not the finished T14 UI or a networked ten-round match.

## Work

1. Implement the reviewed `/api/rooms/{roomId}/socket` upgrade. Validate exact
   Origin, live session and existing room-seat membership before accepting.
   Derive identity from the server binding; route/IDs/JSON cannot impersonate a
   seat. No credential in URL, subprotocol, handshake JSON, or broadcast data.
2. Send private `session.bound` with recipient seat/current state, then use only
   approved public messages for broadcasts. Track each socket's private binding
   and valid connections; connection changes update the public `connected` flags
   and revision when appropriate, not roster membership or host policy.
3. Broadcast a full authoritative snapshot after joins/connection changes and
   implemented lobby mutations. Persist durable changes before acknowledgment;
   a failed socket send does not roll back an accepted room change. Rebuild
   accurate connection state on supported restart/wake paths, not stale flags.
4. Implement authenticated `state.request` and **server-side `board.shuffle`**:
   current host + matching lobby context only; choose another catalog board on
   the server, atomically update board/revision/replay outcome, broadcast to all.
   The product Shuffle button is wired later in step 7, not rebuilt here.
5. Validate bounded client frames through T13 after raw size/binary checks.
   Enforce reviewed message/resource protections, ID-conflict/exact-retry rules
   and latest snapshots accompanying command results. Retries must not shuffle
   again. Reject stale lobby context, wrong-room/unknown seats and non-hosts.
6. Enforce session expiration/revocation on already-open connections according
   to the T14.1 design, not only on upgrade. Invalidate/close unauthorized sockets
   and avoid further state delivery; do not turn that security event into an
   unapproved host-transfer or abandoned-player gameplay policy.
7. Supply reproducible same-origin development-tool/browser-console instructions
   for session/create/join/socket/state/shuffle and explicit resume/reopen.
   Browser-managed HttpOnly cookies stay private. No Act as/seat-override debug
   command in network mode and no production create/join UI in this checkpoint.

## Verification and acceptance

- Two isolated browser profiles/devices bind to different seats in one room,
  receive correct private identities and matching public roster/board/revisions.
  Two ordinary tabs share the same identity; do not count them as two people.
- Host shuffle reaches both sockets; non-host shuffle and stale/wrong-room
  requests fail without changing the board. Exact duplicates preserve the first
  outcome/current snapshot; conflicting ID reuse cannot replace it.
- Private binding/replies never go to other sockets. Public snapshots omit
  credentials, solver/undo internals, stored requests and socket metadata.
- Invalid/expired/revoked sessions and bad Origins cannot upgrade or continue
  commands; test actual runtime socket/HTTP boundaries, controlled clocks, frame
  limits and lifecycle behavior, not only mocked `send` calls.
- Disconnect/explicit resume and object restart/wake preserve seats, selected
  board, revisions and replay safety. Report limitations; this does not certify
  T17 automatic mobile background recovery, grace, takeover or host continuity.
- Exercise PC plus Android over approved local HTTPS if certificate/network
  setup is authorized and available; otherwise use distinct desktop profiles
  and record the missing phone check. Never claim emulation as real phone testing.
- Run focused/integration and full workspace tests, type checks, production build,
  whitespace checks; record counts, actual browsers/devices and failures.

## Stop point

Review with the owner after both browsers receive matching live lobby data.
Document current console/tool limitations and outstanding security/setup decisions.
Steps 6–9 (product UI, connected UI, live Start locking, complete T14 verification)
remain pending. Do not add bidding, demonstrations, a solver recovery policy,
deployment, certificates/trust changes, a commit, or another checkpoint implicitly.

## Implementation record

- Worker authenticates exact HTTPS Origin, method/upgrade, canonical room UUID and
  existing cookie before routing. Query parameters and subprotocols are rejected:
  no credential-bearing URL/protocol is supported. It constructs a fresh private
  binding request, discarding all caller-supplied identity headers and raw cookies.
  Room revalidates session identity and existing seat before accepting. Anonymous,
  expired/revoked, unseated and pending/unknown-room upgrades fail safely.
- Room uses the hibernation WebSocket API. Private attachments contain only schema
  version, session/room/seat IDs and original issue/expiry times, never raw tokens.
  Runtime-restored sockets are checked against Registry and room membership.
  Cold starts with lost transports repair stale persisted connection flags instead
  of trusting stored `connected: true`. No host transfer or seat deletion occurs.
- An in-object event queue serializes asynchronous auth checks, membership updates,
  commands, close/error handling and expiry reconciliation. Flags/revision change
  only when the actual valid-seat connection set changes. Four sockets per session
  per room are allowed; closing one tab does not disconnect another valid tab.
- The initial `session.bound` is private and precedes snapshots on that connection.
  Broadcasts pass the public-message validator and contain full current snapshots
  only. Joins, connection changes and accepted shuffle changes are published.
  Private command results never go to another socket. State persists before
  acknowledgment; failed sends close the transport, not undo accepted changes.
- `state.request` records a no-op and returns a current snapshot. `board.shuffle`
  requires current room/host/lobby context and atomically commits another catalog
  board, revision and outcome. Exact retries do not shuffle again. Membership and
  socket commands share the SAME session/room replay namespace and capacity limits.
  New work at exhaustion closes with 1013; retained exact retries remain readable.
- Incoming text is checked against 4,096 UTF-8 bytes before JSON parsing; binary
  frames are rejected. The platform has already delivered the string/ArrayBuffer
  to the callback, so this is not a claim of controlling allocation inside the
  WebSocket runtime. Server messages remain bounded at 65,536 bytes. Persistent
  per-session/per-room budgets enforce 120 inputs/minute, including retries/invalid
  frames, across tabs and reconnects. Unimplemented Start/gameplay closes with
  1013 without executing or inventing a new protocol rejection reason.
- Registry session validity is checked before commands and state delivery; cached
  cookies/attachments do not grant ongoing authority. A Room alarm enforces the
  earliest hard session expiry, with checks again on every use. Revocation is
  detected on the next command, delivery/reconciliation or expiry event, not by a
  new public logout endpoint. Registry failures fail closed. T15 must integrate
  bidding deadlines with this Room alarm rather than overwrite expiry scheduling.

Runtime tests use independent cookie jars and real WebSocket pairs through the
Worker route, not just mocked sends. They cover private/public separation, joins,
shuffle/retry/conflicts, host/context/room checks, tab limits and closes, revocation,
controlled expiry alarms, malformed/binary/oversized input, rate/replay capacity,
and restoration from real attachments into a fresh controller. Full runtime
shutdown/recreation preserves selected board/seat/replays, repairs connection
flags, and accepts a rebind whose old shuffle ID replays without another shuffle.
Forced platform hibernation eviction is not available in the pinned test adapter;
attachment reconstruction is tested separately from the actual cold restart.

No real browser profiles or Android HTTPS session was exercised: certificates/
device trust have not been installed or authorized. Runtime tests are not browser
cookie acceptance evidence. Review the [console procedure](../local-development.md)
with the owner next; product UI and a networked match are still not implemented.

Verification on 2026-10-28: 120 server / 1,041 workspace tests passed; workspace
type checks and production web build passed. The pinned Windows runtime emitted
temporary-directory cleanup and canceled I/O-context diagnostics; the final run
had no failed assertions or unhandled errors. An isolated-storage failure during
development was fixed by reconstructing the test controller with the Room's
native bindings, not test-worker RPC capabilities. No warnings were hidden and
no broad temporary-directory cleanup was performed. No commit/deployment added.
