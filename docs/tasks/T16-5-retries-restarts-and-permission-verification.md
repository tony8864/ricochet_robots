# T16.5 — Retry, Restart and Permission Verification

## Status and purpose

Complete; follows [T16.4](T16-4-final-results-and-return-to-lobby.md).
Audit and close reliability/security test gaps in the assembled T16 flow. This is
not permission for a broad refactor or T17 implementation.

## Verification scope

- Audit existing tests before adding duplicates. Cover two and six seats, multiple
  tabs for one seat and stale actions from a former active bidder. Host privilege
  alone must not grant movement. Invalid/expired identity cannot act or receive
  private/sensitive state; membership remains separate from online flags.
- Test simultaneous serialized actions and stale attempt versions. One browser's
  single-pending guard is not protection against malicious/multi-tab senders.
  Exact accepted/rejected/no-op replays retain outcomes after Undo, Reset, bidder
  change, success, Continue and rematch. Conflicting ID reuse never replaces them.
- Inject transaction failures at action/result/replay/job boundaries: no partial
  robot/history/score/revision update, double point, second Give Up or duplicate
  next-round job. Accepted scoring and all-four official carry-forward are atomic.
- Full local runtime shutdown/recreation with nonempty history, post-Undo/Reset
  versions, a later bidder, Round Result, pending next preparation, Finished and
  returned lobby. Preserve attempt identity/version, scores, positions, frozen
  queue, history and replays; never rerun creation/search to repair state.
- Explicit reconnect must recover a snapshot and resolve an uncertain original
  request before enabling a fresh one. Do not play stale animations or merge
  offline inputs. Dropped acknowledgments, old sockets and out-of-order/equal-
  revision conflicts must not overwrite newer authoritative state.
- Preserve bidding deadline normalization, fixed session expiry and preparation
  scheduling/recovery when no sockets remain. No new demonstration timer, grace
  policy, host takeover or unrestricted skip for a disconnected bidder.
- Audit public projection, validation failures, route allowlists and logging for
  credential/proof/history leakage. Include any animation metadata in strict
  validation/privacy tests. Inspect stored history/resource costs without adding
  an unapproved gameplay limit or evicting retained command outcomes.

## Work and checks

Add focused tests where gaps exist, using deterministic fixtures/controlled clocks
and private failure seams. No sleeps, public solver/debug endpoints, deployment,
data reset or credential/trust changes. If a correctness defect is found, explain
and fix only the smallest in-scope issue with a regression; ask before changing
rules or architecture.

Run relevant tests, then workspace `pnpm test`, `pnpm typecheck`, `pnpm build`
and whitespace checks. Record counts, commands, warnings, failed attempts and
limitations. This is targeted reliability verification, not a complete T20 audit.
Stop with evidence and a T16.6 handoff; do not claim device/full-match completion.

## Audit evidence

Existing coverage was reviewed before extending it; no production correctness
defect was found and no gameplay/transport implementation was changed here.

| Area | Reused coverage and focused additions |
| --- | --- |
| Permissions/identity | Existing membership/session/Origin/socket limits and two-/six-client bidding tests. Added two-/six-seat frozen-attempt permissions and a real two-tab host race: exactly one Give Up applies, the other context becomes stale, and the former bidder cannot control the next attempt even as host. Added active-bidder session expiry: close with 1008, no post-expiry messages or upgrade, same attempt/host preserved, no automatic skip/transfer. |
| Serialization/replays | Existing duplicate bids, scoring, Continue and rematch cases. Added retained accepted/rejected/no-op outcomes replayed after Undo/Reset, next bidder and result; conflicting reuse does not replace the original. Both host tabs share the authenticated session ledger and cannot skip another bidder by retrying. |
| Transactions | Existing move/win/bid/Continue/rematch rollback and preparation-acceptance failure tests. Added eight Undo/Reset/rollover/exhaustion cases injecting failure before room-state UPDATE or replay INSERT; complete private/public state remains unchanged, then the exact request applies once. |
| Runtime restart | Existing pending/running/error/Thinking/Bidding/overdue/attempt/later-bidder/result/preparation/Finished/lobby shutdown/recreation tests. Added post-Undo history/version and successful scored-result restart. Every restart now compares the entire private replay ledger; attempt-bearing phases replay a persisted accepted request after recreation without changing state or awarding/applying again. |
| Client recovery | Existing lost replies, reordered snapshots/results, immutable requests, ignored old sockets, equal-revision conflicts, explicit rebind and pending-action guards. Added a conflicting same-revision snapshot during an uncertain move: recover by rebind, keep the original request immutable, block fresh actions until exact retry resolves, then use the current version. |
| Scheduling | Reused controlled-clock bidding boundaries, no-client expiry, fixed session lifetime, earlier session expiry versus later bidding alarm, preparation running-job recovery/cooldown/missing-alarm repair. New active-session expiry test confirms that session scheduling is not a demonstration timer or abandoned-attempt policy. |
| Privacy/resources | Inspected production routing/Wrangler entry, strict request/public projection paths, recipient authorization, stored-history replay and logging. Reused recursive secret-marker, malformed-boundary, raw-size, replay-capacity and no-public-test-route tests; added live transcript checks excluding raw credentials, private session IDs, proofs and retained history. No animation metadata was added in T16.2. |

## Changes and test boundaries

- Only existing test files/harnesses and verification documentation changed in
  this checkpoint. No new dependency, UI, protocol, gameplay rule or server policy.
- Restart seed mode obtains a short proof only to exercise real successful
  commands before shutdown. Inspect/replay/restore paths do not recreate the
  match or search. The test-only `/replay-attempt` harness and private ledger dump
  are bundled solely by persistence tests, not the Wrangler production entry.
- Full-runtime restart assertions compare private history, attempt metadata,
  scores/positions/queue/used targets and ledger records; authenticated WSS tests
  independently verify identity/recipient behavior. A private harness is not an
  authenticated external client or physical-device E2E test.
- New assertions use controlled time and direct transaction failure injection,
  with no sleeps, database resets, trust changes or public solver/debug endpoint.

## Resource/privacy review and remaining limits

- Existing bounds remain: 4 KiB client frames, 64 KiB server messages, 120 inputs
  per session/minute across tabs, four sockets per session/room, 10,000 retained
  replay records per session/room and 100,000 per room. Capacity fails closed;
  accepted/rejected/no-op records are not evicted to make retries unsafe.
- Retained history is private and restore validation is linear in its length:
  each step uses temporary one-move history, not repeated growing-prefix copies.
  JSON copying/canonical comparison and recipient authorization can revalidate
  the room several times per message, so total work grows with history and
  connections. No worst-case long-attempt or hosted CPU/memory benchmark is
  claimed, and no unapproved bid/history limit or retention change was introduced.
- No production console/logger call or test-harness import was found in the
  inspected server entry/handlers. Public allowlists omit history/proofs/private
  credentials, and validation errors remain bounded. This is a targeted audit,
  not the broader T20 security/deployment review.
- T17 still owns automatic reconnect, liveness, grace/abandoned-attempt skip,
  host transfer and expiry policy. Keeping an expired bidder's attempt unchanged
  here verifies the current boundary, not delivery of those future features.
- T16.6 must still verify the complete networked match and actual device/browser
  behavior. Pure ten-round scripts and isolated final-round fixtures are not
  evidence of a ten-round live multi-device game or iPhone Safari compatibility.

## Check results and handoff

- Added 16 cases: eleven attempt permission/replay/failure cases, two authenticated
  WSS cases, two new full-runtime restart modes, and one client conflict/rebind case.
  Existing restart cases were also strengthened to compare/replay durable outcomes.
- `pnpm --filter @robot-puzzle/server exec vitest run test/attempts.test.ts test/sockets.test.ts`:
  52 passed. Server type checks passed.
- Final `pnpm test`: **1,346 passed** — 102 engine, 124 puzzles, 192 match,
  390 shared, 317 web, 221 server (204 Worker plus 17 runtime-restart tests).
- `pnpm typecheck`, `pnpm build` and whitespace checks passed. No assertion,
  restart or type-check failure occurred in this checkpoint. Known Worker
  IoContext cancellation/Windows EBUSY temporary-directory cleanup warnings were
  emitted by passing runs with exit zero; no broad cleanup or reset was attempted.
- Changed files: `apps/server/test/attempts.test.ts`, `sockets.test.ts`,
  `preparationRestart.worker.ts`, `preparationRestart.test.ts`,
  `apps/web/src/lobby/liveLobbyClient.test.ts`, and verification/task/plan notes.
  No production implementation or dependencies changed.
- T16.5 is complete. When requested, T16.6 should compose the entire authenticated
  ten-round match/rematch with deterministic fixtures and guide the separate
  owner device checklist. Stop here: no T16.6 implementation, commit or deployment.
