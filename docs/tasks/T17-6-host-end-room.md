# T17.6 — Host End Room

Status: implemented; automated verification on 2026-11-02. The owner subsequently
accepted the core guided manual checks; exact device/browser versions were not
recorded. Follows the approved lifecycle/contracts.
Parent: [T17](T17-reconnection-and-room-lifecycle.md).

- Add host-only End Room with confirmation in lobby and active-match More Actions.
  Show Skip Round only in Thinking. Provide host closure access in Finished as
  well, without replacing New Match or blocking existing recovery controls.
- Authorize closure server-side; cancellation has no effect. Persist a terminal
  state/replay outcome before notifications; invalidate old code/invites/resume.
- Close the room for everyone and route clients to entry with a clear host-ended
  message. Returning offline clients discover the same terminal status. Do not
  fabricate match completion, award points, select winners or auto-start a lobby.
- Stop gameplay/preparation scheduling and auto-reconnect; preserve reviewed
  tombstone/replay retention for retries and recover Registry cleanup across
  partial failure. Do not revoke a browser's unrelated-room identity.

Test guest rejection, every room phase, double confirmation/retry, simultaneous
commands, disconnected host rejection, delayed preparation completion, offline
clients, runtime restart and partial cross-object cleanup. Closed rooms must not
be resurrected by old Start/Continue/Join/Resume requests.

## Implemented behavior and boundaries

- Host End Room is the last item in every connected lobby/match/result menu,
  below a #263852 divider. It uses the inline Lucide DoorClosed SVG (16px),
  #F0A5A9 icon/text, 14px medium label. The ISC notice is shipped in the web public
  assets; no dependency was added. Skip Round remains Thinking-only and its icon
  is now #A8BED8. Guest Leave is unchanged.
- End confirmation reuses the existing native modal sizing, safe-area/scroll and
  focus/stacking behavior, with Cancel / red #B94352 End Room. Cancellation sends
  nothing. Pending state disables repeat confirmation; recovery/retry feedback is
  available inside the modal, including above Round Result. Board/SVG/game rules
  and New Match remain unchanged.
- `room.end` has boolean confirmation and exact lobbyId or matchId context. The
  server authenticates the responsive socket, verifies the original host/current
  context and commits the closing revision, terminal intent and original receipt
  in one SQLite transaction. A storage failure rolls everything back. It retains
  the prior phase/scores/positions rather than fabricating Finished or a winner.
- Versioned `room_terminal` wins before initialization, membership, gameplay,
  preparation, alarms and normal publication. Delayed preparation commits are
  ignored. Clients receive `room.closed` with `host-ended`, close this room's
  transport/recovery and return to a fresh entry form with an explanatory message.
  A terminal-navigation remount also fixes the freshly joined form retaining its
  entered view. No identity cookie is cleared, renewed or revoked.
- The Room commits first and sends notifications, then its durable outbox calls
  Registry directory invalidation. Failures retry at five-second intervals, with
  one intent per room and no tight loop. While the directory is stale, the closed
  Room independently refuses entry/initialization; an old routed code cannot
  reopen it. Permanent directory tombstones override pending/published creation
  records, suppress creation recovery/publication, reject old Create/Join/Resume
  and WSS entry, and prevent room ID/code reuse.
- Since closed sockets cannot be rebound just to retry, authenticated same-origin
  `POST /api/rooms/:roomId/retry` provides read-only exact receipt lookup using the
  original room envelope. It shares bounded runtime parsing, Origin/content-type/
  cookie checks and Registry bootstrap budget, authenticates current membership,
  and never executes/allocates a request. Conflicts/missing receipts stay explicit.
  This preserves accepted End and earlier receipts without reopening transport.
  Clients seeing definitive closure need not replay End: refresh/failed-upgrade
  recovery discovers `room-closed` and stops instead of issuing a new identity.
- Conservative retention uses the approved maximum **24 hours after closure**,
  sufficient for every already-issued fixed-lifetime member identity to expire.
  After acknowledged Registry redaction, purge only this room's private state,
  initialization, membership/replay/history and transport rows. Postpone cleanup
  if the outbox cannot finish. Keep minimal terminal/code tombstones. Directory
  capacity accounting includes redacted tombstones in the existing 1,000 cap;
  retained creation rows keep per-session accounting while identities may live.
  Browser sessions and unrelated rooms are not deleted. No 30-minute open-room
  expiry or other T17.7 policy is implemented here.

## Verification

Phase tests cover Lobby, Preparing, Thinking, Bidding, Demonstrating, Round Result
and Finished; guest/confirmation/stale-context rejection; exact replay; immutable
scores/positions; late preparation; transaction rollback; five-second retry;
retention/redaction failure; creation/code tombstones. Full-runtime tests cover
all tabs receiving closure, competing host tabs, offline same-seat recovery,
accepted/missing receipts, rejected old creation/code, unchanged identity and
creating a different room. A full runtime restart preserves terminal closure,
rejects preparation progress and replays the original accepted End receipt.

The first full run found a missing `browser_sessions` table in the new isolated
directory test fixture; adding its normal session initialization fixed the test,
without a production change. Existing workerd IoContext/alarm-cancellation and
Windows EBUSY temporary-cleanup warnings remain. Local verification does not
certify hosted costs, solver performance or rendered Safari behavior.

Final verification: **1,506 tests passed** in the complete workspace run (engine
102, puzzles 124, match 193, shared 414, web 417, server Workers 230 and full-runtime
persistence/client 26). Workspace type checks, production build and whitespace
checks passed. The final full run required no increased test timeout.

## Manual review still needed

Reload the frontend tabs and run the updated backend together.

1. Host sees End last with the requested icon/colors/divider; guest sees Leave.
2. Cancel preserves room, roster and connection. Confirm sends both players to
   entry with the host-ended message; no extra points/result is manufactured.
3. Old room code/invite is rejected. The same browser can create/join another room.
4. End during a match and from Round Result/Finished; confirm modal focus,
   scrolling, recovery controls and compact header layout on phone.
5. Offline guest returns after End: it learns closure and stops reconnecting.

No staging, commit, deployment or automatic start of T17.7 is part of this task.
