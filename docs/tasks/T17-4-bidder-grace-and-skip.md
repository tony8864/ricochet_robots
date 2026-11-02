# T17.4 — Disconnected Bidder Grace and Skip Attempt

Status: implemented, automated verification completed 2026-11-02; the owner
subsequently confirmed core countdown/disabled/enabled Skip, Cancel, rollback to
next bidder, rejoin/Undo retention and exhausted-queue no-point result checks.
Exact device versions and a manual multi-tab pass were not recorded. Follows
T17.2–T17.3; T17.5 was completed first.
Parent: [T17](T17-reconnection-and-room-lifecycle.md).

- Persist/recover the current attempt's 60-second server-owned disconnect grace.
  Begin at detected disconnect, or attempt start when the selected bidder is
  already offline. Do not charge them time spent waiting behind another bidder.
- Show safe public eligibility/waiting feedback. After grace, expose confirmed
  Skip Attempt only to the host; keep Thinking Skip Round a distinct action.
- Recheck host, phase, match/round/attempt and offline eligibility at acceptance.
  Any responsive authorized tab cancels eligibility; reconnect-before-skip wins
  when serialized first. A stale confirmation cannot skip the next bidder.
- Reuse failure rollback/queue progression with atomic public/private/replay writes.
  No point, automatic forfeiture or timer on a connected demonstration.

Test exact deadline boundaries, reconnect races, two host tabs, duplicate/stale
requests, restart, offline next bidder, all-offline room and exhausted queue.
Verify all-four rollback, unchanged official positions and no score duplication.
Run engine/match/shared/server/web checks appropriate to changes.

## Implementation

- Versioned private `StoredRoom.attemptPresence` binds the attempt ID, activation
  time and absence token/deadline to the public Demonstrating snapshot. It is
  stored with room/replay state in existing SQLite transactions, not in the pure
  engine. Older rooms without it are accepted and normalized once on wake.
- Offline queued bidders get grace from attempt activation (the bidding deadline
  for the first bidder, skip/Give Up acceptance for the next), never from time
  spent waiting. A newly disconnected bidder uses the effective last lease/close
  time, clamped to activation. A responsive tab cancels absence; a later absence
  creates a new UUID. Restart does not reset established deadlines/tokens.
- Public `disconnect` is null while connected or contains `disconnectId`,
  `disconnectedAtMs`, `skipAllowedAtMs`, and `grace | skippable`. It is optional
  only for retained pre-T17.4 snapshots; missing metadata grants no permission.
  Strict parsers reject extra fields, invalid deadlines/status/IDs and a claimed
  absence for a connected bidder. Allowlist projection never exposes history.
- `attempt.skipDisconnected` requires boolean confirmation and exact
  match/round/attempt/version/absence context. The server checks current host,
  offline state and its own clock. It resolves exact retries before stale-context
  checks. Atomic rollback and receipt persistence share the existing ledger and
  limits; no new identity, queue replacement, scoring or host transfer occurs.
- Pure internal `attempt.abandon` shares Give Up's failure path after server
  authorization, without impersonating the bidder. It cannot be sent as a player
  command. All four robots restore from round start before the next frozen bidder;
  the exhausted queue ends the round without points. There is no automatic skip.
- One grace alarm joins existing lease/session/bidding/preparation obligations.
  Eligibility produces one public revision, not countdown-tick revisions. Losing
  the host or every connection does not cancel bidding or fabricate a forfeiture.
- `DisconnectedAttemptPanel` temporarily replaces demonstration controls/status
  below the board: #111F35, #263852 border, 10px radius, 12px padding, player/bid
  and move-count row. All players see the message and right-aligned yellow
  #FFD166 18px semibold countdown. Only the host sees the full-width 44px Skip
  Attempt button: #B94352/white enabled, #3A4658/#8995A6 disabled, 10px radius,
  no shadow. Eligibility is server-snapshot-owned; local zero cannot enable it.
  Native confirmation is followed by a client recheck and server authorization.
- Reconnection restores existing demonstration UI; provisional moves/history are
  preserved until an accepted skip. Board rendering, square sizing and compact
  header height remain unchanged. The ordinary bidding countdown remains white.

## Verification and handoff

Deterministic tests cover the exact 60-second boundary, host/confirmation/context
authorization, fresh absence after reconnect, multi-tab lease aggregation and
delayed detection, no automatic forfeiture, offline next bidder's fresh grace,
rollback/unchanged scores/official positions, stale/duplicate requests and atomic
failure. Full-runtime tests cover persisted grace normalization, accepted-skip
replay after restart, real client/server competing host tabs and lost Skip reply
followed by same-ID retry after refresh. Existing two-/six-player ten-round flows
remain covered.

All package suites, workspace type checks, production build and whitespace checks
were run. The first concurrent server run hit the existing six-player 60-second
test timeout; the complete sequential server rerun passed without changing that
timeout. Existing workerd IoContext/alarm-cancellation and Windows EBUSY cleanup
warnings remain; passing local tests do not certify hosted resources or Safari.

Final passing totals across package runs: **1,478 tests** (engine 102, puzzles 124,
match 193, shared 409, web 406, server Workers 220, full-runtime persistence/client
24). The server Workers suite was rerun with `--no-file-parallelism`; no timeout
was increased. Workspace types/build and the final added fixture type check pass.

No rendered/physical-device verification of this new panel is claimed. Reload
the frontend tabs and run the updated backend together for the protocol extension.
Next manual checks: host vs guest visibility, disabled button through grace,
reconnect before skip (including a second tab), cancel/confirm, rollback/next
bidder, final-bidder no-point result, and narrow-phone layout. T17.6 End Room and
T17.7 empty-room expiry remain separate; nothing is committed or deployed.
