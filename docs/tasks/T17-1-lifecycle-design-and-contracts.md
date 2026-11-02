# T17.1 — Lifecycle Design and Contracts

Status: complete — owner approved this design on 2026-11-01. No live behavior or
TypeScript contracts changed. T17.2 remains a separately requested implementation.
Parent: [T17](T17-reconnection-and-room-lifecycle.md).

1. Inspect current cookie identity, room/registry persistence, sockets, replay
   ledger, public contracts, alarm scheduling and entry/connected UI ownership.
2. Specify state/transition tables for per-connection liveness, seat presence,
   bidder grace, explicit Leave, End Room and empty-room expiry. Include every
   match phase, same-seat tabs, session expiry and zero connected players.
3. Resolve the parent's open Leave semantics with the owner before implementation.
   Describe exact Skip Attempt safeguards and closure/expiry races; no host transfer.
4. Propose minimal wire/public metadata, contextual authorization, replay rules,
   durable schema/migration, terminal tombstones and Registry/Room cleanup recovery.
   Do not promise cross-object atomicity or immediate delivery to offline clients.
5. Specify heartbeat/retry bounds and budgets, clock sources, app suspension/resume,
   stale-callback cancellation, exact pending-action recovery and terminal routing.
   Propose UI confirmations without treating them as backend authority.

Deliver a reviewable design in this task and update approved boundary docs. Check
existing tests/types for compatibility; report what was inspected/run. Stop for
owner approval before T17.2 or adding behavior/contracts that commit the design.

## 1. Current implementation inspected

- `sessions.ts`: fixed 24-hour HttpOnly cookie identity, private verifier/session
  records and server-side validity checks. No nickname-based recovery.
- `registry.ts` / `creations.ts`: one directory, durable creation reservations,
  code/ID lookup and bounded creation recovery. Registry and Room commits are
  separate. Creation replay currently calls Room initialization again.
- `room.ts` / `roomMembership.ts`: Room serializes entry/socket/alarm work via
  `LiveLobby.run`; existing sessions resume their seat before lock/capacity checks.
  `StoredRoom` wraps public state plus private membership and versioned match.
- `liveLobby.ts`: hibernation attachments contain private session/seat binding;
  up to four sockets per session per room. Presence currently means an authorized
  socket reports OPEN, not a proven responsive browser. No heartbeat lease exists.
  Earliest alarm combines session expiry, preparation and bidding. Recipient
  authorization occurs before delivery. `socketRoute.ts` returns plain HTTP
  failures on unsuccessful upgrade, so a browser cannot infer the reason from
  a generic WebSocket error alone.
- `lobbyCommands.ts`: canonical session/room replay ledger shared with membership,
  atomic match/public/revision/outcome persistence, 120 inbound messages/minute
  per session, 10,000 replay rows/session/room and 100,000/room. Presence must not
  fill this ledger. No Leave, End Room or abandoned-attempt command is implemented.
- Shared parsers are strict protocol v1, including nested state. `room.closed`
  already exists with `expired | unavailable`; no host-ended reason or lifecycle
  rejection exists. Full Finished is a valid match result, not room closure.
- `liveLobbyClient.ts`: generation guards, server-time estimate, one pending
  immutable action, explicit rebind/retry and presentation snapping exist. Pending
  state is memory-only. `RoomEntry` owns entry-to-connected rendering but has no
  terminal/departure callback or automatic refresh recovery. `main.tsx` initially
  renders entry. Nickname convenience is already separate from identity.

## 2. Product decisions proposed for approval

Already agreed: original host stays host; 60-second disconnected-bidder grace
then confirmed host skip, no automatic failure; bidding time continues; 30-minute
continuous empty-room expiry; fixed 24-hour identity; guest Leave versus host End.

**Recommendation for guest Leave:** this tab voluntarily exits the view, not the
roster. Close only its transport, cancel its reconnect/resume intent and show the
entry form. Preserve the authenticated seat, nickname, accepted bid, score and
original roster order in every phase, including lobby. It continues to occupy one
of six seats; no replacement slot is freed. The guest may explicitly join/resume
again with the same valid identity. Other open tabs remain in the room.

This keeps Leave reversible and avoids adding permanent membership removal or
cross-tab revocation. It deliberately means a departed lobby guest still occupies
a seat; starting still uses the existing minimum of two seated players, not a new
online-player requirement. Do not implement this tradeoff until accepted.

Leaving while active is not Give Up: if this was the final live tab, normal grace
begins; the host can skip after it expires. If another tab remains responsive,
no grace begins. Never close a room or reset the browser identity when a guest
leaves. No new server Leave command is needed under this recommendation.

**Confirmation copy proposed:**

- Leave: "Leave this room? Your seat, bids and points will be kept. You can return
  with this browser while your session and the room remain available." Buttons:
  Cancel / Leave Room. Explain in the dialog that other tabs stay connected.
- End: "End this room for everyone? Everyone will return to the entry screen.
  This room cannot be reopened." Buttons: Cancel / End Room.
- Skip Attempt: "Skip [nickname]'s disconnected attempt? Their moves will be
  reset and the next bidder will try." Cancel / Skip Attempt.

Use a compact accessible confirmation with background inertness, focus handling
and recovery feedback. Leave/End/Skip are secondary administrative actions; don't
reuse the yellow main gameplay action for them. Cancel sends no mutation. Existing
Thinking Skip Round confirmation remains unchanged. Exact visual polish may be
reviewed in each UI subtask; it must not change authorization.

## 3. State transitions and timing

All comparisons use trusted server milliseconds. At a deadline, due work is
normalized before a new request; receipts already committed still replay safely.

| State/event | Result |
| --- | --- |
| Authenticated socket binding | Allocate unique connection ID, lease for 30 seconds, send current binding/snapshot; online if room is open |
| Timely valid input/heartbeat on that connection | Renew that connection's lease, not the identity lifetime; do not publish a room revision unless public state changes |
| Definitive socket close | Retire only that connection; recompute the seat from other live connections |
| Lease/session expires | Retire connection before considering late traffic; a new authenticated binding is required |
| Seat loses last live connection | Record offline time; if active bidder, establish grace; if last room seat, establish empty deadline |
| Same seat authenticates a new connection before room expiry | Mark online, cancel its grace and room emptiness; restore snapshot, never old animation frames |
| Old connection closes after new bind | Retire old connection only; never overwrite new presence |
| Offline bidder becomes active | Start grace at attempt activation, not at earlier time spent waiting in queue |
| Grace deadline arrives | Mark current disconnected attempt eligible; no game transition or automatic forfeiture |
| Host confirms eligible current Skip Attempt | Atomically roll back all four robots and advance queue or create no-point round result |
| Rebind serialized before Skip Attempt | Cancel eligibility; reject the stale skip |
| Skip serialized before rebind | Return the later authoritative attempt/result on rebind; never resurrect skipped history |
| Everyone offline for 30 minutes | Terminal expiry; no automatic scoring or winners |
| Host confirms End Room in any open phase | Terminal host closure; stop gameplay, close code and notify clients after commit |
| New Match from Finished | Existing same-room lobby behavior, not closure; fixed host and room lifecycle continue |

Lease expiry is `lastSeenAtMs + 30_000`; evaluate it even if an alarm is late.
For the final responsive socket, that effective expiry time starts absence,
not the delayed alarm's processing time. A definitive close uses detection time.
Grace is `max(seatOfflineSinceMs, attemptStartedAtMs) + 60_000`. Reconnecting
and disconnecting later creates a fresh absence/grace token; no restriction on
repeated reconnects is added without separate fairness approval.

Emptiness is `emptySinceMs + 1_800_000`; only a completed authorized binding
cancels it, not an HTTP lookup, rejected join, stale ping or outgoing broadcast.
Successful room creation starts empty at initialization, so rooms never opened
on a socket can expire too. Returning at the deadline is too late. Migration of
an old room with no reliable offline timestamp starts a new window at migration,
rather than inventing past inactivity. Repeated initialization cannot restart it.

For Lobby, Preparing, Thinking, Bidding, Demonstrating, Round Result and Finished,
presence/recovery/empty expiry apply equally. Guest Leave preserves phase. Host
End is available in all of them. Only Demonstrating uses bidder grace; only
Thinking retains Skip Round. Bidding normalizes its deadline while empty; no
phase pauses because a browser sleeps. Do not run new preparation after terminal
closure or accept a stale preparation result into a closed room.

The host's absence/identity expiry never promotes a guest. If the host identity
expires while guests remain online, host-only actions cannot resume. Show honest
feedback; guests can leave and create another room. This is an explicit consequence
of no host transfer, not an excuse to issue a replacement host credential.

## 4. Proposed wire contracts (not implemented)

Recommend **protocol v2**, with one coordinated shared/server/web upgrade, because
v1 parsers reject added fields and old clients do not implement leases. Do not
pretend new required binding/lifecycle data is backwards-compatible. Reject v1
explicitly and show an update-required message; do not loop forever reconnecting.
Preserve old private match schemas/replay records during storage migration; the
wire upgrade does not authorize deleting them. For a historical pending v1 room
request, propose a v2 `command.retry` RoomEnvelope with empty context, the SAME
outer/original commandId and a command body `{ type: 'command.retry',
originalRequest: <strictly parsed v1 room request> }`. Original roomId must match
the bound room; no nested retry envelopes. This is lookup-only: authenticate the
original member, look up the existing canonical v1 request/receipt, and return its
retained outcome in a v2 response. A missing receipt returns bounded
`retry-not-found` and performs no original gameplay action; tell the user it could
not be confirmed rather than inventing success. Conflicting canonical data is an
ID conflict. Ordinary pending v2 actions use existing direct exact retry. Never
rewrite old canonical JSON in place or grant general v1 gameplay acceptance.

| Direction/type | Proposed fields/behavior |
| --- | --- |
| Existing `session.bound` | Add private `connectionId` UUID; includes current public room snapshot and server send time as before |
| Client `connection.ping` | Transport envelope: version, type, roomId, connectionId, increasing safe-integer sequence; no command ID or client timestamp |
| Private server `connection.pong` | Echo connectionId/sequence, serverTimeMs; no room revision or state change solely for a heartbeat |
| Client `attempt.skipDisconnected` | Existing command envelope, `confirmed: boolean`, attempt context plus current `disconnectId`; host-only after grace |
| Client `room.end` | Existing command envelope, `confirmed: boolean`, context bound to current lobbyId or matchId; phase-bound authorization before commit |
| Client `command.retry` | Historical v1 receipt lookup only, using the same commandId and nested original room request as specified above; no fresh mutation |
| Public room snapshot | Minimal lifecycle metadata described below; existing phase/board/score fields remain authoritative |
| Existing `room.closed` | Add `host-ended` reason alongside `expired | unavailable`; roomId/lastRevision/serverTimeMs, never a fake Finished snapshot |
| Existing bootstrap rejection | Add `room-closed` / `room-expired` for authenticated HTTP join/resume, without allocating a seat |
| Existing command rejection | Add bounded `bidder-connected` / `disconnect-grace-active` / terminal-room reasons; keep not-host, stale-context and confirmation-required |

Heartbeat parsing is a separate bounded WebSocket transport union, not a fake
`PlayerMatchCommand`. Strict allowed keys and limits still apply; HTTP bootstrap
does not accept heartbeats. A connection ID is correlation, not a credential;
only the already-bound socket may use it. Repeated/decreasing sequence values do
not extend its lease. Any valid authenticated room command can renew a live lease
even if its gameplay outcome is rejected, but cannot revive an expired connection.

Public metadata: top-level lifecycle `{ emptyExpiresAtMs: number | null }` and,
only in Demonstrating, `disconnect: null | { disconnectId, disconnectedAtMs,
skipAllowedAtMs, status: 'grace' | 'skippable' }` bound to the existing attempt.
Keep per-seat `connected` booleans. Do not publish last heartbeat details,
connection IDs of other tabs, session IDs, private history or credentials.
Normalize/publicly revise once on grace eligibility, not every second. UI time
remaining is informational; the host's role and server state still gate skipping.

The pure match package gets a trusted host-authorized abandonment action that
reuses Give Up rollback/queue logic; it must not pretend the host is the active
bidder. Socket leases, credentials and timers stay outside that pure package.
Server checks current disconnect token/eligibility and match context together
before invoking it. Existing replay outcomes win before stale attempt/version
preconditions; conflicting IDs remain rejected. Disconnection is not itself a
move/Undo history event; do not rewind attempt version to move count.

`room.end` commits its terminal revision and receipt atomically. Its exact retry
by the still-valid original member can return the accepted receipt even though
the room is closed; every new gameplay command is denied. Unrelated earlier
receipts may still be returned privately during retention, but can never restore
their old public state. Closed-room responses do not require a fabricated playing
snapshot. HTTP resume is used to distinguish terminal causes when WSS upgrade
fails, because browser WebSocket errors hide the underlying response.

## 5. Durable storage, normalization and terminal cleanup

Propose separate versioned lifecycle tables next to existing `room_state`, not a
new database or a new game phase. Preserve private match v1–v5 readers.

- Room lifecycle: open/closed, schema version, empty start/deadline, terminal
  reason/time/revision, current absence/grace token/attempt bindings, cleanup due.
- Connection leases: unique connection ID, private session/seat IDs, last accepted
  sequence, lastSeen/deadline, original identity expiry and private attachment
  version. Remove retired connection rows; maximum four active/session remains.
- Terminal outbox: stable closure ID and idempotent pending Registry invalidation/
  redaction intent. Terminal receipt and minimal tombstone survive full restarts.

Initialize/migrate tables with `CREATE IF NOT EXISTS` and explicit metadata;
reject unsupported/corrupt versions. Never replace `room_state` with a shape its
current validator would accept incorrectly. Load lifecycle before initialization,
membership, commands, preparation and socket publication. Closed tombstone wins
even when replayed creation asks Room.initialize again.

Common normalization in the serialized Room event path: terminal check; due lease/
session retirement and effective presence times; empty-room expiry; live bidding
expiry and grace reconciliation; public commit/broadcast; earliest alarm repair.
Recheck after awaited Registry authorization and immediately before transactions.
Rebind must normalize emptiness before cancelling it. Alarms, reads and rejected
commands cannot extend grace/empty deadlines. After closure, only retry delivery
and cleanup work remain scheduled. Use minimum of lease/session, preparation,
bidding, grace, empty-expiry and cleanup deadlines, not independent setAlarm calls.

At closure, commit locally first. Then notify live clients using `room.closed`,
return private command outcome where applicable and close transport. No delivery
acknowledgment is required to make closure real. Room RPC to Registry marks code/
room lookup closed and prevents pending creation publication from resurrecting it.
Persist/retry invalidation on failure (initial recommendation: 5 seconds, bounded
batches of ten, no tight loop); Registry temporarily routing to a closed Room is
safe because Room denies entry independently. No transaction spans an RPC.

**Retention proposal requiring approval:** keep terminal receipts and private
membership mappings until every existing member's fixed identity has expired
(at most 24 hours after closure; retain each member's verified expiry when joined).
Only then purge full room/match/history, replay bodies, nicknames, transport rows
and creation initialization payloads. Retain a minimal roomId/code/reason/time/
revision tombstone to prevent reinitialization/code reuse and explain stale links.
Do not revoke the browser identity or delete other rooms. If the Registry outbox
is incomplete, postpone sensitive cleanup rather than losing its durable intent.

For this bounded private version, retain these minimal tombstones within the
existing 1,000 total creation-record cap and original per-session creation limits;
do not silently increase capacity or evict closed codes for reuse. This is not
unlimited long-term hosting: capacity replenishment/tombstone retention beyond
the initial private trial needs an explicitly reviewed later policy. Session-store
cleanup must preserve the reviewed issuance/creation accounting; don't delete
shared identity records just because one room closed.

## 6. Heartbeat and client recovery strategy

Recommend a ping immediately after binding and every **10 seconds** thereafter;
server lease is **30 seconds**. Fixed 120 messages/minute/session remains inclusive
of heartbeats (four tabs use about 24 normal heartbeat messages/minute). No heartbeat
ledger entries or snapshot broadcasts; bound raw frames to existing 4 KiB maximum.
Over-rate traffic uses existing protection rather than bypassing it. Persisted
lease renewal costs real storage work; measure locally and verify hosted limits
before deployment. This design makes no hibernation/free-tier performance promise.

Client uses monotonic time for its 30-second no-response watchdog/backoff, not a
local wall clock to authorize gameplay. Valid server traffic proves reception;
server liveness is based on incoming authenticated traffic. On watchdog loss,
close that generation, mark read-only and reconnect. After browser suspension,
visibility/online may trigger immediate replacement/rebind; do not trust paused
timers or replay missed inputs. Multiple tabs are separate connections with one
seat identity, not separate players.

Retry delays: 0, 1, 2, 4, 8, then maximum 15 seconds, with bounded ±20% jitter
(injected randomness in tests), one in-flight attempt and existing ten-second
binding timeout. Continue while the room view is mounted and recovery is transient;
pause while offline, reset after successful binding, and coalesce online/resume/
manual retries. Rate-limit HTTP resume probes to one per ten seconds per tab;
don't spend Registry bootstrap requests on every heartbeat. Terminal, auth-expired,
update-required or explicit Leave stop all retries/listeners. Malformed/conflicting
server data fails closed and requires explicit resynchronization, not an infinite
automatic error loop. Cleanup/old generation guards cover Strict Mode/unmount.

Persist only safe resume routing and at most one pending validated room command
in tab-scoped `sessionStorage`: version, roomId, action ID/payload/context and
optional result correlation. Save before send, clear after authoritative receipt/
snapshot reconciliation. Cookie remains the only identity credential. Treat this
storage as untrusted, bounded by existing frame limits and strictly parsed. Do not
persist board proofs, private history, cookie/session IDs, or server authorization.
If storage is unavailable, keep in-memory recovery and explicitly report that
refresh cannot retain the uncertain action; never manufacture a new action ID.

On reload, resume saved room via existing authenticated `session.resume` POST
before opening WSS; do not call `session.open` as a recovery shortcut. An explicit
different invite takes precedence over auto-resume to another room. Clear this
tab's auto-resume marker after Leave/terminal outcome, not the remembered nickname.
Stale recovery data must never allocate a new seat. Other tabs are not forcibly
navigated by a guest Leave. Review sessionStorage copied-tab behavior in tests:
duplicated pending IDs may replay but cannot apply twice.

After rebind, request the current snapshot and reconcile an uncertain command by
its exact stored ID/payload; recommend retaining the current explicit Retry
pending-request control rather than silently resubmitting a destructive action.
Never infer acceptance from robot positions, and never replace pending context
with the latest round/attempt. Until resolved, block new mutations but allow
connection recovery. Confirmed End Room pending state is retained until accepted,
rejected or terminal status is known; a lost response cannot reopen the room.

Terminal routing belongs to the entry/connected flow, not the SVG or pure match.
Show "The host ended the room." / "This room has expired." on entry, preserve the
nickname and allow an explicit new Create/Join. Expired identity has separate
feedback and the existing explicit Start a new session path. Never clear identity
or silently re-enter the old invitation after closure. Offline clients learn the
outcome on their next authenticated contact, not via guaranteed push delivery.

## 7. Implementation boundaries and verification plan

Expected implementation files: shared request/message/public-state validators and
tests; Room/Registry/lifecycle persistence helpers; existing transport/membership/
creation/command/preparation scheduling; a small trusted match abandonment handler;
entry/client recovery helpers; header menus and accessible confirmations. Do not
touch SVG geometry, board catalog or solver budgets. No new dependency, database,
account system, background service or deployment is required by this design.

Minimum test matrix for each subtask:

1. Lease before/at/after expiry; no outgoing-traffic renewal; clean close; four
   tabs; invalid/old connection ID/sequence; session expiry; real runtime restart.
2. Binding failure/backoff/offline pause/resume/refresh; stale generations; strict
   parsers; one pending action; exact accepted-but-unacknowledged retry; storage
   unavailable; protocol mismatch; entry terminal navigation and Strict Mode.
3. Grace start for active versus queued bidder; reconnect and host-skip races;
   exact deadline; repeated disconnect; unavailable host; rollback and queue
   exhaustion; no automatic failure; no new point or changed official robots.
4. Leave cancel/confirm/other tabs, retained lobby capacity/score/bid and explicit
   return; End permissions/every phase, double requests, transactional rollback,
   delayed preparation completion, Registry outage and restart recovery.
5. Empty start at creation; delayed alarms; reconnect just before/at deadline;
   no-socket migration; terminal replay/create/lookup/resume; private purge only
   after auth/replay retention; tombstone remains; unrelated identities untouched.

Run relevant pure/shared/server/web tests and types at implementation checkpoints;
compose real two-/six-seat HTTP/WSS and full-runtime persistence scenarios in T17.8.
Use controlled clocks and fault injection, not real 30/60/1,800-second sleeps.
Owner PC/phone Wi-Fi/background/lock/resume checks remain separate evidence;
specific iPhone Safari and hosted performance remain unverified until exercised.

## Review gate / handoff

Owner approval recorded on 2026-11-01: "i agree with 17.1". The design and choices
listed below are accepted, including tab-local reserved-seat Leave, protocol v2/
historical receipt lookup, heartbeat/retry scheduling and terminal retention.
References to proposals/required approval elsewhere in this document describe the
reviewed design, not outstanding decisions. Any material departure needs review.
Approval closes T17.1; it does not automatically start implementation or commit.

Before T17.2, owner approval is required for: tab-local seat-preserving Leave,
confirmation intent, the v2/retained-request compatibility approach, ten-second
heartbeat and bounded retries, private-data retention/tombstones under existing
capacity, and public grace/lifecycle metadata. If approved, freeze these contracts
and implement them in the ordered subtasks, with tests. If not, revise this design
only. No live behavior, schema migration or runtime protocol has changed here.

## Inspection and baseline checks (2026-11-01)

Inspected the files listed in section 1, shared request/message types/parsers,
socket/membership routing, session/creation schemas, entry routing and existing
Skip confirmation handling. Documentation-only changes: this task, T17 overview,
plan and architecture proposal note. No product-rule change beyond the previously
approved baseline, production code, wire type, dependency or infrastructure edit.

- `pnpm --filter @robot-puzzle/shared test`: 390 passed.
- `pnpm --filter @robot-puzzle/server exec vitest run test/sockets.test.ts test/membership.test.ts`:
  46 passed, including current same-seat multi-tab/rebind/session-expiry/replay cases.
- `pnpm --filter @robot-puzzle/shared typecheck`: passed.
- `pnpm --filter @robot-puzzle/server typecheck`: passed, including test types.
- `git diff --check`, task trailing-whitespace and local Markdown-link checks:
  passed. Known Windows IoContext shutdown/EBUSY cleanup warnings occurred in
  server tests; exit status was zero. No broad temporary cleanup was performed.

These establish today's compatibility baseline, not execution of the proposed
heartbeats, automatic recovery, grace skip, closure or expiry. No new browser/
device, hosted-resource or full-workspace verification is claimed for this design.
