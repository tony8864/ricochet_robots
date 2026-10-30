# T14.9 — Final T14 Verification

## Status and scope

Complete on 2026-10-30 for the T14 room/lobby/initial-Start boundary, with the
mobile disconnect limitations below explicitly retained for T17. This is not
full-match, iPhone, deployment or automatic mobile-recovery certification.

This record combines **owner-reported manual results** from the guided PC/phone
checks with the actual automated command results. The agent did not operate the
phone or independently observe its display. It supersedes older pending browser/
device checkpoint notes in the T14 implementation documents.

## Manual verification

Environment: local backend and HTTPS frontend, PC browser plus incognito identity,
and the owner's Galaxy A36 5G on the same Wi-Fi. No new certificate, firewall,
Origin, browser permission or hosting changes were made during this verification.

| Test | Result and evidence |
| --- | --- |
| 1. Create and join | Owner confirmed PC Create and phone Join reached the same lobby, board/code and two player names. |
| 2. Live roster | Owner confirmed an incognito third player appeared on both other screens without refresh; 3 / 6 seats. |
| 3. Host Shuffle | Owner confirmed all three screens showed the same changed board/name without refresh. |
| 4. Guest controls | Owner confirmed guests lacked Shuffle/Start and saw the host-waiting message. Server-side authorization is covered separately by runtime tests. |
| 5. Minimum roster | Owner created a separate one-seat room and confirmed Start was disabled. Original room remained open. |
| 6. Synchronized Start | Previously owner-confirmed: PC and phone both entered Preparing after host Start. Not unnecessarily repeated solely for numbering. |
| 7. No late joins | Previously owner-confirmed: a new identity received the match-already-started message. |
| 8. Existing-seat rejoin | Previously owner-confirmed: phone refresh and rejoin in the same browser retained its seat and returned to Preparing. This is explicit rejoin, not automatic reload recovery. |
| 9. Wi-Fi loss/reconnect | **Limited, not a full pass.** Phone showed Reconnect, but restoration returned to entry; explicit code-based rejoin worked. Host still showed 3 online during reported outage. See limitations below. |
| 10. Backend restart | Owner started the original room, stopped/restarted only the backend, and confirmed return to the same room/board/roster/Preparing state using reconnect or explicit rejoin. No duplicate seats reported. |
| 11. Copy room code | Owner confirmed PC and phone copied the correct code, with the temporary checkmark and code remaining visible. |
| 12. Automated checks | Agent ran the commands below: all passed. |

## Automated verification

- `pnpm test`: **1,152 passed** — 102 engine, 124 puzzles, 192 match, 378 shared,
  223 web and 133 server (130 Worker tests plus 3 full-runtime restart tests).
- `pnpm typecheck`: all workspaces passed, including server/runtime test types.
- `pnpm build`: TypeScript and production web build passed.
- `git diff --check` and `git diff --cached --check`: passed. The index was empty.
- Relevant automated coverage includes strict message/auth boundaries, 24-hour
  expiry, capacity, host-only actions, exact replay/ID conflicts, late-join locks,
  existing-seat resume, atomic Start rollback, storage consistency and restart.
- Known Worker runner diagnostics: IoContext inactivity/canceled waitUntil tasks
  and Windows EBUSY temporary-directory cleanup warnings at shutdown. Test commands
  exited 0 with no failed assertions; warnings were not hidden or "fixed" through
  broad temporary-file deletion. Git also reports normal LF-to-CRLF notices.
- Local `.dev.vars`, HTTPS environment paths, Worker storage, generated runtime
  declarations and build output remain ignored. No credentials were copied into
  this record, and no staging, commit, deployment or gameplay-code change occurred
  as part of T14.9.

## Known limitations and handoff

1. The installed Vite development client reloads after a lost development socket
   reconnects. The observed return to entry is consistent with that source path,
   but was not conclusively traced with phone logs. In-memory room binding is lost
   on a full reload. Existing-cookie explicit rejoin works; automatic recovery is
   still T17, not a completed capability.
2. Online flags currently follow sockets the server considers open. Abrupt Wi-Fi
   loss need not produce a prompt server close event. There is no heartbeat-based
   liveness deadline, so stale online counts are possible. Seat count (3 / 6) is
   membership, not connectivity. Record and address bounded detection/recovery in
   T17; do not infer it from successful explicit rejoin or graceful-close tests.
3. Tests used up to three real identities; six-player capacity/Start and malicious
   requests are automated evidence, not a six-phone manual test. iPhone Safari,
   long background suspension, host continuity and full network matches remain
   unverified/later scope.
4. Preparing intentionally remains stable with no revealed target. T15 must review
   server-runtime solver resources and unsuccessful-preparation recovery before
   implementing target preparation, Thinking/Bidding and server deadlines. T16
   owns synchronized demonstrations; T17 owns broader recovery/host policies.

T14 is complete within that scope; Milestone 4 is **not** complete. Discuss T15
next only when requested. No next implementation task or commit is automatic.
