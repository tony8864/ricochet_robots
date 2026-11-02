# T17.3 — Automatic Client Recovery

Status: complete — implemented and automated verification passed (2026-11-01).
Parent: [T17](T17-reconnection-and-room-lifecycle.md).

- Add bounded backoff/retry and approved liveness responses to the existing client
  adapter. Handle offline/online and visibility/resume; avoid parallel reconnects.
- Restore room/seat with existing authenticated resume, including page refresh.
  Store only safe room-routing metadata, never credentials/proofs in client state.
- Show last snapshot read-only while reconnecting; enable writes only after current
  binding/snapshot. Snap to current positions, never replay missed animations.
- Retain exact unresolved command ID/payload and existing retry safety; do not
  replay offline inputs, create new bids/moves or reset the server bidding deadline.
- Keep manual Reconnect accessible in modal/results views. Stop retries for explicit
  departure, unmount, terminal room or expired identity. Ignore old socket callbacks
  and cancel timers/listeners reliably, including Strict Mode cleanup.

Use fake clocks/sockets/lifecycle events to test backoff, refresh/resume, old events,
pending accepted-but-unacknowledged commands and terminal failures. Verify actual
HTTP/WSS recovery and web type/build checks. Record device verification separately.

## Implementation

- Connected adapter: one reconnect generation, cancellable cookie-authenticated
  HTTP resume, binding timeout, 30-second inbound-response watchdog, bounded
  jittered backoff and manual fallback. Offline pauses traffic; online, visibility
  return and BFCache pageshow coalesce recovery. Delays follow 0/1/2/4/8/15 seconds
  with bounded jitter/cap; HTTP resume probes are at least ten seconds apart.
- Fresh known entry initially opens WSS directly. Later recovery resumes before
  WSS, without `session.open`. Writes require matching private binding/current
  snapshot; old socket/HTTP callbacks cannot change the current generation. Fresh
  binding snaps through the existing presentation epoch. Bidding stays unpaused.
- Strict versioned tab-scoped sessionStorage holds room/code/seat routing and at
  most one immutable pending room request, never cookies/session credentials,
  board snapshots, private history or solver data. Bound size/shape and room IDs;
  historical requests use T17.2's receipt-only wrapper.
- Save before send; clear pending after authoritative outcome/revision reconciliation.
  Refresh restores through HTTP and private WSS; lost action replies still require
  explicit exact Retry, not fresh IDs or automatic destructive resubmission. No
  offline input queue/new seat. Storage denial visibly warns about refresh limits
  while keeping current-instance memory recovery.
- Entry owns a recovery gate and terminal feedback. A different/invalid invite
  cannot silently enter the saved room. Malformed/conflicting/update errors stop
  automatic loops. Closed/expired seats clear only this room's resume marker,
  not nickname/cookie. Expired identity requires explicit new-session consent.
  Returning to entry from failed refresh cancels recovery, not backend membership.
- Timers/listeners/probes clean up on disconnect/unmount/Strict Mode. No host
  transfer, grace/Skip Attempt, backend Leave/End, empty expiry, protocol bump,
  production backend/SVG/solver change, new dependency or deployment.

## Files and automated evidence

UI/navigation: RoomEntry and ConnectedLobby. Client helpers: liveLobbyClient,
roomRecovery, recoveryEnvironment, resumeRoom and entryRecovery, with tests.
Full-runtime tests: `apps/server/test/clientRecovery.test.ts` / `.worker.ts` in
the existing persistence suite. Test-only DOM types permit importing the actual
web adapter; production server compiler libraries remain unchanged. Test ID helper
parameters were explicitly typed as strings to avoid DOM Crypto UUID inference.

Fake-clock tests cover offline pause/resume, coalesced/throttled probes, watchdog,
stale callbacks, terminal/update/malformed errors, refresh/exact retries, storage
tampering/denial, invitation precedence, bounded bootstrap parsing and Strict Mode.
Two full Worker-runtime cases bridge the actual frontend adapter to actual
cookie/session/create/join/resume endpoints and WebSockets: restore an offline
guest to the same seat/current board; and enter real verified demonstration,
drop a move acknowledgment, refresh through entry recovery and exactly retry it.
The server reports duplicate; count/positions/scores do not change a second time.
Controlled test-only clocks replace deadline sleeps; server rules/budgets stay.
This is network-boundary evidence, not rendered-browser/TLS/physical-device E2E.
No test clock route is referenced by the production entry/configuration.

Development fixes: JSX test filename/inferred types, fake-clock next-tick assertion,
and translating browser fetch options to the Worker transport bridge. Windows
isolated SQLite stack release failed in the first network harness; cases moved to
fresh full-runtime instances using established persistence infrastructure, awaited
requests/sockets and validated owned-temp cleanup. Other Workers-suite isolation
was not weakened. Both cases then passed (~2 seconds combined local wall time,
not a hosted CPU/resource benchmark). Final workspace checks are recorded below.

Known Windows IoContext/EBUSY and alarm-cancellation warnings may remain. No broad
temporary cleanup, certificate/firewall changes, commit or infrastructure change.

Final checks:

- `pnpm test`: **1,430** — engine 102, puzzles 124, match 192, shared 405, web 372,
  server Workers 215 and full-runtime/persistence 20 (including two client recovery
  cases). No new ten-round/gameplay rule is inferred beyond the existing fixtures.
- `pnpm typecheck`: all workspace packages, including server test types, passed.
- `pnpm build`: passed. Final offline-write/terminal-state guard was additionally
  verified with all 372 web tests and the web TypeScript/production build.
- `git diff --check` and separate new-file whitespace/local task-link checks:
  passed. The network bridge's Headers conversion needed a final test-only type
  adjustment; rerunning both full-runtime recovery cases and types then passed.

The offline sensor is checked before allocating/sending an input, even if its
event callback has not run. Already-terminal states cannot be downgraded by a
late/offline action. Bootstrap Create/Join requests before a room is known remain
the existing in-memory entry flow; this checkpoint persists live room commands,
not speculative room creation across a pre-entry refresh.

## Owner-reported recovery smoke checks

The owner confirmed each of these guided PC/phone HTTPS checks working:

1. Lobby refresh restores the same room code and two players.
2. Wi-Fi off (mobile data off), 40-second wait: PC count drops to one online;
   Wi-Fi on: automatic same-room recovery without pressing Reconnect, two online.
3. Phone lock for 40 seconds, unlock/return: same lobby/code, no duplicate player.
4. Refresh during bidding preserves round/target/bids and the continuing deadline.
5. Refresh after two nonwinning demonstration moves preserves positions/count;
   Undo restores the first-move positions/count on both screens.
6. Refresh on round-result modal preserves result/scores; one host Continue
   advances both screens exactly once.
7. Refresh at Finished preserves standings/scores; one New Match returns both
   players to the same lobby/code without auto-starting.

These are owner reports, not agent-observed device execution. Exact browser/OS
versions were not recorded; no specific iPhone Safari or hosted test is claimed.
The initially reported blank page was not reproduced when opening a fresh tab;
the entry screen and subsequent checks worked. Its original cause is unconfirmed.
Manual lost-ack/exact-retry reproduction, recovery controls during an unresolved
modal request and broader multi-tab/failure cases were not individually confirmed;
retain their automated evidence and remaining combined verification scope.
T17.8 retains the combined device gate; T18 retains rendered-browser E2E. Stop
before T17.4 unless requested.
