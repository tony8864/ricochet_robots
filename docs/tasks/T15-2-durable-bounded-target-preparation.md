# T15.2 — Durable Bounded Target Preparation

## Status and prerequisites

Implemented; follows reviewed [T15.1](T15-1-local-workers-preparation-benchmark.md)
evidence and its resource-policy gate. Part of [T15](T15-server-owned-phases-bidding-and-timers.md).
Implement server behavior and narrowly necessary shared/pure contracts, not UI.

## Scope

1. Review existing Room event serialization, Start transaction, replay ledger,
   session-expiry alarm, stored-match validation and pure preparation acceptance.
   Briefly state the concrete storage/job/retry contract and bounded cooldown
   choice before coding. Ask if evidence requires a consequential architecture
   change or new product fallback.
2. Extend versioned private persistence to validate Preparing job/status data and
   Thinking state, including private/public consistency. Preserve existing lobbies
   and valid initial Preparing matches, including ones already started under T14.
   Schedule their missing first preparation safely without recreating a match.
   Corrupt or unsupported state fails closed; do not reset durable storage.
3. Persist one current preparation identity, request context, server-owned candidate
   order, bounded policy and durable due work with Preparing. A new Start must
   commit its job intent with state/replay so a crash cannot lose scheduled work.
   Repair a missing platform alarm from durable due work on wake/recovery.
4. Execute through a subsequent Room scheduled invocation, not synchronous Start
   or an untracked promise. Multiplex preparation and session expiry using the
   earliest outstanding due work; process bounded work and reschedule remaining
   obligations. Reauthorize delivery and retain existing expiry protections.
5. Use current official positions and unused targets. Reuse pure T10 selection
   and T11 stale-context/proof acceptance; expose a narrow pure request/accept API
   if necessary rather than bypass validation or introduce timers/networking into
   pure packages. Respect the policy reviewed after T15.1.
6. Commit only a result matching the current job, match, round, locked board,
   official positions and used IDs. Atomically persist Thinking/public revision
   and target consumption before broadcast. Duplicate alarm delivery or a stale
   result must not reveal/consume twice or overwrite a newer preparation.
7. Persist deferred, unavailable and sanitized operational-error outcomes without
   changing gameplay state. Distinguish unknown solvability from exhaustive failure.
   Bound recovery of interrupted jobs; never create an automatic endless search
   loop. Document crash/re-delivery behavior and aggregate work per logical attempt.
8. Define and implement the smallest explicit preparation-retry wire extension:
   strict request/context parsing, safe public current-preparation identifier and
   retry eligibility/timing metadata as needed, plus existing reply semantics.
   Review its concrete shape before implementation; never accept client budgets,
   candidate orders, target choices, proof data or job authority.
9. Authorize Retry for the current host in deferred/error Preparing only, with a
   current-preparation guard, bounded server cooldown and existing rate/replay
   protection. Preserve exact command retries and reject conflicting reuse. One
   accepted new retry creates one job; duplicate requests or multiple sockets
   cannot enqueue another. Unavailable is not retryable. Reordering is not a
   guaranteed remedy; no budget escalation or mutation of used IDs to skip work.

## Likely files

- `apps/server/src/room.ts`, `liveLobby.ts`, `lobbyCommands.ts`, `storedMatch.ts`
  and small preparation/alarm modules if justified by current conventions.
- `packages/match` preparation API and `packages/shared` request/public-state
  contracts, parsers and projection; dependency direction remains unchanged.
- Focused unit, Worker, socket and full-runtime restart tests.
- Architecture/local-development notes describing implemented behavior, plus
  implementation evidence in this task. No product-rule change.

## Checks and completion

- Real Start schedules work; its initial transaction does not invoke the solver.
- Real selector/proof acceptance reaches Thinking from catalog fixtures. Injected
  cutoffs/errors exercise failure handling without expensive/flaky tests.
- Verify no repeat/already-complete reveal, carry-forward request positions,
  invalid proof rejection, stale results, duplicate alarms, atomic rollback,
  cooldown/host/stale-context/replay checks and unchanged official state on failure.
- Actual runtime shutdown/recreation at pending/failed/completed job boundaries
  preserves state and resumes only eligible work; no duplicate target consumption.
- Session expiry and preparation due work coexist, including when all sockets
  are absent. Public snapshots/logs/replies contain no proof or private authority.
- Run relevant shared/match/puzzle/server tests and type checks, plus whitespace
  checks; record results and remaining resource/recovery limitations.

Stop before client UI, bids, bidding alarms or movement. Provide a reusable
Preparing-entry hook for T16's eventual Continue path; do not implement Continue
or fabricate a round result here.

## Implementation record — 2026-10-30

- Added `preparationJob.ts` for fixed-budget server-shuffled request snapshots
  and `roomPreparation.ts` for reusable queued entry, legacy migration, claim,
  acceptance and bounded crash recovery. Start persists one v2 queued job with
  its match/revision/replay transaction and arms the earliest due alarm before ack.
- Extended the strict private codec for v2 Preparing/Thinking and job/request/
  budget/diagnostic/public consistency. Old v1 initial Preparing gains one job on
  wake without recreation; old lobbies stay compatible. No data reset/migration
  wipe. Corrupt/unknown fields, versions and unsupported phases fail closed.
- One logical job permits at most one selector call: durable running marker plus
  a 30-second recovery obligation precede search. Re-delivery before due does no
  work; interrupted or uncertain commits become explicit error afterward rather
  than repeating search. This can abandon a job before it has searched, prioritizing
  bounded work; host retry is the recovery path. No automatic search loop.
- Fixed policy remains 50k expanded/150k retained per candidate, 200k aggregate.
  Success is independently accepted through the pure match boundary and atomically
  stores Thinking, used ID and revision. All failures preserve official state.
  Session-expiry and preparation/recovery alarms share earliest-due scheduling.
  Persisted intent repairs a missing platform alarm on the next wake/publish;
  no external watchdog or cross-object transaction guarantee is claimed.
- Added strict `preparation.retry` with `{ matchId, preparationId }` context.
  Host-only deferred/error retry has a five-second cooldown; exact rejected or
  accepted command retries preserve their outcome. A fresh accepted request
  replaces one job atomically. Unavailable/working are not retryable. Safe optional
  public retry ID/time metadata contains no budgets, candidate order or proofs.
- Exported existing pure snapshot/acceptance helpers for trusted controllers;
  no pure rule change, clocks/networking in packages, or player solver command.
- Added protocol/privacy tests, real Worker preparation tests, WSS reveal/retry
  checks and full-runtime queued/running/error/Thinking restart tests, including
  missing-alarm repair. Existing started-runtime test now waits for real Thinking.
- Final verification: `pnpm test` passed **1,184 tests** (102 engine, 124 puzzles,
  192 match, 390 shared, 223 web, 153 server including seven full-runtime restart
  tests). `pnpm typecheck`, `pnpm build` and whitespace checks passed. Existing
  IoContext cancellation/Windows EBUSY cleanup warnings occurred with no failed
  assertions; no broad temporary-directory cleanup was attempted.
- No client UI, bids, Skip/Continue, movement, hosted testing, commit or deployment
  added. No physical-device verification is claimed for this server checkpoint.

### Owner-visible boundary

The server can now leave Preparing, but the existing connected frontend still
shows its unsupported-later-phase placeholder. This is intentional until T15.3;
do not expect a usable Thinking screen or host Retry button from T15.2 alone.
