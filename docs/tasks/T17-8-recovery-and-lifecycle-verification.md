# T17.8 — Recovery and Lifecycle Verification

Status: automated verification and guided core PC-host/phone-guest checks passed
(2026-11-02). Broader device coverage remains unverified as listed below.
Follows T17.1–T17.7.
Parent: [T17](T17-reconnection-and-room-lifecycle.md).

Automate two-/six-seat authenticated scenarios combining actual HTTP/WSS,
controlled liveness/deadlines, durable restarts and gameplay. Cover transient
loss/resume, uncertain commands, grace/host skip, guest Leave, host End Room,
empty expiry, terminal retries and old-code rejection. Verify no divergent scores,
positions, attempt history, deadline or host authority. Keep real process restart
evidence distinct from controller rebind and browser rendering evidence.

Run workspace tests, type checks, build and whitespace checks; document actual
counts, failures/fixes and known runtime warnings. Do not weaken solver budgets,
use shortened matches as ten-round proof, or expose hidden solutions for testing.

List owner checks first, then guide one at a time on the existing approved HTTPS
PC/phone setup: Wi-Fi loss, background/lock/resume, refresh, two tabs, host absence,
bidder grace/cancel/skip, Leave/return, End Room and empty-room expiry. Check both
devices and recovery access inside modals/results. Record actual versions and
reports; claim iPhone Safari only if exercised. No CA/firewall/deployment changes.

Update tasks/plan/architecture/protocol handoff to actual behavior. Keep missing
checks open unless the owner accepts documented limits. Stop before T18, commit
or deployment; this checkpoint does not replace T18 browser E2E/security review.

## Owner checklist and evidence

Guide one check at a time, using the existing HTTPS PC/phone setup. Before the
combined pass, confirm the local expiry override is removed and backend restarted;
use a fresh room. Record current PC browser/version, phone OS/browser/version,
which device hosts, and observed behavior. Earlier setup identified a Galaxy A36
5G with Android 15; current browser versions were not supplied. No iPhone Safari
pass is claimed.

| Check | Expected result | Evidence so far |
| --- | --- | --- |
| Wi-Fi loss/return | Observer count drops after lease detection; same seat automatically returns; no duplicate roster entry | Owner confirmed combined phone Wi-Fi/data-off recovery check after about 40 seconds |
| Background/lock/resume | Current phase/target/deadline restored; no stale or queued input | Owner confirmed combined phone lock/resume after about 40 seconds, matching PC target and seat |
| Refresh | Preserve accepted bids/attempt; recovery remains reachable in round-result modal and Finished | Owner confirmed combined phone round-result refresh, then PC and phone final-results refresh with identical standings and host-only New Match; earlier T17.3 covered bids/attempt |
| Two tabs | Closing one keeps the seat online; final close marks it offline; roster seat remains | Owner confirmed both PC tab-close stages and same-browser/code return to the original host seat, without duplicate players |
| Host absence | No transfer; permitted guest play continues; host resumes original authority | Owner confirmed guest bid/expiry/demonstration without host, guest Give Up/result waiting, and original host rejoin with Continue |
| Bidder grace/cancel/skip | Reconnect preserves attempt; only host can skip after 60 seconds; all-four rollback/next bidder once | Core T17.4 owner checks passed; combined pass pending |
| Leave/return | Cancel does nothing; confirmed guest departure is tab-local; explicit join restores same seat | Core T17.5 owner checks passed; combined pass pending |
| End Room | Cancel does nothing; confirmed host End returns all clients to entry; old code rejected | Core T17.6 owner checks passed; combined pass pending |
| Empty expiry | All connections absent expires room; a connected room remains alive | Owner confirmed expiry with a 10-second local override; exact devices/connected-room variant not separately recorded |

The short expiry check verifies behavior, not an observed 30-minute wall-clock
wait. Automated clocks cover the production deadline and early-return cancellation.
No actual `.dev.vars`, trust settings, firewall or running development servers
were changed by this verification task.

These combined checks used PC as host and phone as guest. Reports are the owner's
confirmations, not agent-operated browser observations. Current browser versions
and the reverse-role/device variants were not supplied. Final-results refresh on
both devices was subsequently confirmed. Earlier core grace/Leave/End reports remain valid
evidence but are not relabeled as newly repeated combined tests.

## Automated coverage map

| Layer | Evidence |
| --- | --- |
| Real frontend adapter + HTTP/Worker WebSocket pairs | `apps/server/test/clientRecovery.test.ts`: eight scenarios, including new six-seat combined host absence, bid lowering/original tie priority, bidder return/cancel, later host skip, all-client equality and End/old-code rejection |
| Uncertain actions and guest departure | Same adapter suite verifies lost move acknowledgment, persisted original retry, no double movement, tab-local Leave, retained bid/attempt, grace skip retry and terminal receipts |
| Server authority and boundaries | `presence`, `roomTerminal`, `sockets`, `attempts`, `bidding`, `rounds` suites: multiple tabs, invalid/stale traffic, exact deadlines, host-only actions, transactional rollback, expiry, retained receipt/outbox cleanup |
| Full ten-round games | `fullMatch.test.ts`: two-player winner, six-player tie, two-player no-winner, same-room return and fresh Start; unchanged real match length and solver budgets |
| Real runtime disposal/recreation | `persistence.test.ts` and `preparationRestart.test.ts`: SQLite identity/membership and queued/running/error preparation, bidding, corrections, success/result, Finished/rematch, grace/skip, End and overdue empty expiry |
| Frontend recovery/presentation | Recovery/entry/ConnectedLobby/modal/results tests: stale callbacks, backoff, lifecycle events, exact pending IDs, disconnected input suppression and recovery/admin controls inside inert modal/results |

The new combined test uses six independent cookie identities, real admission and
transport, server-controlled clock steps and the production client adapter. It
does not render a browser, emulate mobile suspension or restart a process midway
through that script. Full-runtime disposal/recreation is separate evidence above;
ten-round full-match scripts use controller rebind, not a process restart.

No production-code, game-rule, solver-budget or dependency change was required.
T18 rendered-browser/security verification, iPhone Safari, hosted resource limits
and arbitrary carry-forward solvability remain outside this checkpoint.

## Checks run (2026-11-02)

- Targeted real-client suite: 8/8 passed, including the new six-player scenario.
- `pnpm test`: all 1,530 passed (engine 102, puzzles 124, match 193, shared 414,
  web 417, server Workers 250, separate full-runtime tests 30).
- `pnpm typecheck`, `pnpm build` and `git diff --check`: passed.
- No failed assertions, unhandled test errors or production fixes in this task.
  Known workerd IoContext shutdown/alarm cancellation and Windows EBUSY temporary
  cleanup warnings remain; final command exit status was zero. No broad temporary
  directory cleanup was performed.
- A read-only check found no active `LOCAL_EMPTY_ROOM_TIMEOUT_SECONDS` assignment
  in local `.dev.vars`; no local settings were modified by the agent. Confirm the
  running backend has restarted after removing the test value before manual checks.

Files changed in this checkpoint: the recovery integration test and lifecycle
task/plan/architecture/shared handoff documentation only. Earlier dirty T17 work
was preserved. Nothing staged, committed or deployed. Guided core checks are now
complete; unrepeated combined grace/Leave/End variants, reverse-role coverage,
exact browser versions and iPhone Safari remain explicitly open. Do not infer
those passes or deployment readiness from the core result. Resolve/accept these
limits before treating the broader device-verification scope as closed.
