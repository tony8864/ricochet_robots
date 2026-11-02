# T17.7 — Empty-Room Expiry and Cleanup

Status: implemented; automated verification passed and the owner confirmed the
short-timeout expiry check with a 10-second local override.
Parent: [T17](T17-reconnection-and-room-lifecycle.md).

- Persist a 30-minute deadline when the last responsive authorized connection
  disappears. Cancel it on authenticated return before expiry. Never expire a
  connected room merely for lack of moves/bids or extend emptiness via stale pings.
- Normalize expiry on alarm, cold wake and all entry/mutation paths. Expiry wins
  at its deadline; identity expiry remains the separate fixed 24-hour rule.
- Reuse terminal handling with a distinct room-expired message. Invalidate code/
  invitations, stop work and apply the approved Room/Registry/session-mapping
  cleanup/tombstone retention policy. Handle cross-object failures durably.
- Preserve bidding normalization while empty; no automatic attempt forfeiture,
  scoring, host reassignment or search-budget changes.

Test just-before/at/after deadline, multiple tabs, stale heartbeats, reconnect races,
all phases, object restart, old empty rooms during migration, repeated alarms and
partial cleanup. Prove no resurrection and no deletion of other rooms/identity.

## Implementation

- Presence schema v2 persists `empty_since` and `empty_expires_at`. The final
  responsive authorized connection disappearing starts a continuous empty period;
  only a successful authenticated socket binding before the deadline cancels it.
  HTTP Join/Resume lookups and stale heartbeats cannot extend the period.
- The shared alarm includes this deadline. Cold wake and admission, command and
  preparation gates enforce expiry at the boundary before accepting further work.
  Expiry commits one terminal revision, without changing scores or robot positions.
- Existing terminal outbox, directory invalidation and bounded private-data cleanup
  are reused with the distinct `expired` / `room-expired` reason. Identity and other
  rooms are unaffected. No new panel, public deadline or game rule was added.
- Migration preserves reliable old empty timestamps; unknown timing starts when
  first reconciled. Persisted deadlines survive restart and configuration changes.
- Controlled-clock tests cover all phases, exact boundaries, multi-tab idleness,
  effective lease deadlines, reconnect races, migration, rollback and cold runtime
  recreation. Real HTTP/client recovery tests cover expired codes/resume, early
  reconnect cancellation and reuse of the existing identity for a new room.

## Manual handoff

Production remains 30 minutes. For local testing only, merge
`LOCAL_EMPTY_ROOM_TIMEOUT_SECONDS="60"` into the existing `apps/server/.dev.vars`,
preserving allowed origins. Restart the backend and create a fresh room. Close
all room tabs on every device; reconnecting another tab cancels emptiness.
After expiry, the old code/refresh must report that the room expired, while a
new room can still be created. Test return before the deadline separately.
Remove the override, restart and use a fresh room afterward. An existing empty
period keeps its persisted deadline. Network-loss detection may add up to the
normal 30-second connection lease before the empty countdown starts.

The owner subsequently confirmed the expiry behavior with a 10-second local
override. Exact device/browser versions and early-return/connected-room variants
were not separately reported. Removing the override was advised; its removal is
not recorded as an owner action. T17.8 combined verification, hosted resource
review, deployment and commit remain separate.

## Automated verification (2026-11-02)

Final `pnpm test` passed: 1,529 tests (engine 102, puzzles 124, match 193,
shared 414, web 417, server Workers 250 and full-runtime 29). Workspace type
checks, a final server type check, production web build and whitespace checks
passed. Known Worker IoContext/shutdown and Windows EBUSY cleanup warnings remain;
the final run exited successfully with no failed tests or unhandled test errors.
Controlled-clock fixtures now clean up alarms and distinguish continuously active
24-hour identity tests from abandoned-room expiry. The real recovery test records
admission before refresh, without issuing a rejected WebSocket upgrade through
Miniflare's Node bridge (which produced an unhandled connection-reset error).
