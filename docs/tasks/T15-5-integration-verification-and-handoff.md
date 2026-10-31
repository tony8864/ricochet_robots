# T15.5 — Integration Verification and T16 Handoff

## Status and goal

Complete on 2026-10-31: automated verification passed and the owner confirmed
all seven guided PC/phone checks. Follows
[T15.4](T15-4-authoritative-bids-and-bidding-deadline.md).
Verify the assembled [T15](T15-server-owned-phases-bidding-and-timers.md) slice
and record its exact boundary. Do not implement T16 during verification.

## Automated verification

- Compose real authenticated Start, durable preparation, verified Thinking,
  accepted/revised bids and deadline expiry into one initial Demonstrating attempt.
  Cover two and six seats using deterministic fixtures and controlled clocks.
- Verify target non-repetition/already-complete filtering and request snapshots
  using legal non-initial robot positions in private test fixtures. This proves
  carry-forward preparation inputs, not completed networked scoring in T16.
- Exercise deferred/error host Retry, unavailable blocked feedback, cooldown,
  guest rejection, stale job results, exact duplicate/conflicting command IDs,
  lost acknowledgments and out-of-order public revisions.
- Cover durable transaction failures, pending-job restart, failed/completed
  preparation restart, Bidding restart, overdue recovery and duplicate alarms.
  Session expiry must remain enforced alongside preparation/bidding alarms.
- Confirm snapshots, validation failures and logs never leak proofs, credentials,
  internal request authority or hidden solution routes. No public test endpoint.
- Existing entry/lobby/code-copy/local-simulator and pure rule tests still pass.
  Run `pnpm test`, `pnpm typecheck`, `pnpm build` and `git diff --check`.
  Record commands, counts, warnings, failures and unavailable checks accurately.

## Owner-guided manual checks

List these first, then guide one at a time if the owner requests a walkthrough.
Use the existing separately approved local HTTPS setup; do not change trust,
network settings or deploy as part of testing.

1. PC host and phone guest see the same verified target after Start, with the
   fixed square board and no movement controls while Thinking.
2. Before the first accepted bid, no countdown runs. Either player can make the
   first bid; both then see the same deadline/countdown and submitted bid.
3. Other player submits a higher bid than the first player's bid: accepted.
   Lower one's own bid: accepted and roster reorders. Raise it: rejected.
4. Equal final bids retain original first-accepted priority after lowering.
5. At deadline both enter the same Demonstrating state with the correct first
   bidder, bid limit and round-start robots. No T16 movement is enabled yet.
6. Restart the backend during Bidding and explicitly reconnect/rejoin with the
   same identity: preserve target, bids, deadline and resulting active bidder.
   Do not present explicit rejoin as automatic mobile recovery.
7. Check narrow phone layout, readable header/timer/bids and no interaction with
   the read-only board. Record device/browser details; iPhone Safari remains
   unverified unless actually exercised.

Failure/retry variants should use private automated/test-harness fixtures, not a
public room cheat command. Do not claim a manual failure test if not performed.

## Documentation and handoff

- Record benchmark evidence and the actual selected resource policy, retry wire
  contract/cooldown, versioned storage choice and alarm/crash recovery behavior.
- Update architecture/local-development/task/plan notes to actual implementation,
  not planned behavior; preserve product rules and historical evidence.
- List remaining limitations: hosted resource validation, no ten-round solvability
  guarantee, unavailable preparation has no approved abort/restart escape, T16
  movement/scoring/Skip/Continue/results and T17 mobile/host continuity.
- Identify the reusable Preparing-entry hook, stored-state extensions required
  for later attempts/results, and unsupported connected commands for T16.

Mark T15 complete only after its acceptance checks pass or the owner explicitly
accepts documented limitations. Stop and report meaningful unresolved blockers;
do not hide them behind a completion checkbox. No commit or deployment without
a separate request.

## Automated audit record — 2026-10-31

- Real Start/preparation/Thinking/bids/expiry composition: existing two-/six-client
  WSS tests use actual cookie identity, Room commands, selector/proof acceptance,
  runtime-validated snapshots and controlled alarms.
- Current positions/target filtering: server preparation request snapshot tests
  plus pure T10/T11 tests independently replay real helper-robot solutions, retain
  all carry-forward positions and exclude used/already-satisfied targets. This is
  not a claim that networked T16 scoring is implemented.
- Existing Worker/shared/client tests cover deferred/error host Retry, blocked
  unavailable results, cooldown, invalid proof, stale jobs, duplicate/conflicting
  IDs, immutable lost-reply retries, out-of-order snapshots and transaction rollback.
- Bidding tests cover independent values, own reductions, original tie order,
  just-before/at/after boundaries, no-client expiry and missed-alarm reads.
  Nine full-runtime shutdown/recreation cases cover queued/running/error/Thinking,
  Bidding/overdue Bidding, missing-alarm repair and room/session persistence.
- Added one test in `apps/server/test/sockets.test.ts`: bidding begins just before
  the fixed 24-hour identity expiry. The earlier session alarm closes both sockets
  with 1008 but preserves Bidding and its later deadline. The game alarm then
  creates one attempt with no clients; repeated delivery leaves it unchanged and
  expired credentials cannot reconnect. No sleep or production code change.
- Inspected production entry/Wrangler routing and logging sites; reused public
  projection secret-marker, binding isolation and unavailable test-route assertions.
  No new public test endpoint, raw exception logging or proof broadcast found.
  This is a targeted source/test audit, not a full T20 security/production audit.
- `pnpm test`: **1,239 passed** — 102 engine, 124 puzzles, 192 match, 390 shared,
  259 web, 172 server (163 Worker plus nine runtime-restart tests).
- `pnpm typecheck`, `pnpm build` and whitespace checks passed. Known IoContext
  cancellation/Windows EBUSY shutdown-cleanup warnings occurred with exit zero;
  no broad cleanup or storage reset was attempted. Benchmark timings are not
  rerun here; T15.1 remains the recorded local resource evidence.
- Only this regression and verification documentation changed in T15.5. No
  gameplay, dependencies, trust/network settings, commit or deployment changed.

## Manual evidence ledger

The owner reported T15.3/T15.4 work before requesting this audit. That is general
acceptance, not proof that all recovery/tie/device checks below were performed.
The checks below were subsequently confirmed by the owner on PC and phone.
Exact browser versions/phone model were not re-confirmed in this checkpoint;
the earlier Android setup is historical context, not a new iPhone Safari check.

| Check | Status |
| --- | --- |
| 1. Same target/read-only Thinking on PC and phone | Owner confirmed: same highlighted target and robot positions, no movement controls |
| 2. No pre-bid countdown; first bid/countdown synchronized | Owner confirmed PC bid 7 appears on both devices with approximately matching countdowns |
| 3. Independent higher bid, own reduction/reordering, raise blocked | Owner confirmed phone 9 accepted, reduction to 5 updates/reorders above PC 7 on both, and entering 6 disables Place Bid while accepted 5 remains unchanged; server raise rejection covered automatically |
| 4. Equal final bids retain first-accepted priority | Owner confirmed PC lowers its earlier bid from 7 to 5 and appears above the phone's 5 on both lists; original first-bid tie rule explained and accepted |
| 5. Same initial demonstrator/bid/positions at expiry | Owner confirmed both devices show PC demonstrating at bid 5, 0 / 5 moves, unchanged robot positions and no movement controls |
| 6. Backend restart during Bidding; explicit reconnect/rejoin preserves state/deadline | Owner confirmed same target and PC bid 7 after backend restart/reconnect, without restarting the deadline; explicit recovery only, not automatic mobile recovery |
| 7. Narrow phone readability and read-only board | Owner confirmed board/header/countdown/bid controls/list readable without horizontal scrolling, and robot taps do not select or move during Thinking/Bidding |

All guided confirmations are owner-reported, not agent-operated device/browser
observations. Checks 1–5 verified synchronized targets, first bid/countdown,
independent higher bids, lowering/reordering, UI raise prevention, original
first-bid tie priority and expiry into the same fresh attempt. Check 6 verified
backend stop/restart and explicit same-identity recovery without deadline reset;
check 7 covered phone readability/read-only interaction. No manual solver-error
injection, exact browser-version audit or automatic recovery pass is claimed.
T15.5 and the agreed T15 slice are complete; T16/T17 limits below remain.

## Concrete T16 handoff

- Reuse `queuedPreparation(state, now)` for a future authorized Continue entering
  Preparing; commit durable intent with that transition, never search synchronously
  inside Continue or replace carry-forward positions with board starts.
- Current private codec: v1 legacy initial Preparing; v2 Preparing jobs/Thinking;
  v3 Bidding and the **fresh first** Demonstrating attempt only. T16 needs an
  explicit compatible extension for private move history, corrections, later
  bidders, round results and Finished. Preserve old valid records and never reset
  room storage to bypass an unsupported phase.
- Extend the authenticated transport allowlist/replay path deliberately for
  attempt/result commands. Reuse strict match/round/attempt ID/version context,
  server-authorized actor, public revisions and durable-before-broadcast ordering.
  Unsupported gameplay currently closes with 1013; the local simulator is not a
  fallback. No demonstration timer is approved.
- T16 retains movement, undo/reset/give-up, rollback/success carry-forward scoring,
  host Skip/Continue, final results and lobby return. T17 retains automatic mobile
  recovery, liveness/online-count accuracy, host continuity and abandoned-attempt
  grace. Explicit rejoin is not automatic mobile recovery.
- Preparation stays at 50k expanded/150k retained states per target, 200k aggregate,
  one search per job, five-second host retry cooldown and 30-second interrupted-job
  error recovery. See T15.2 for exact contracts; no automatic budget escalation,
  reset, target reuse, or unavailable-state abort/restart escape is approved.
- Hosted resources, arbitrary ten-round solvability, iPhone Safari and a full
  networked match remain unverified. Countdown is an estimate; only the server
  closes bidding. Do not mark broader milestones complete from this checkpoint.
