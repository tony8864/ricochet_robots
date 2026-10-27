# T13.5 — Protocol Verification and Integration Handoff

## Status and dependency

Complete on 2026-10-27 after [T13.1–T13.4](T13-typed-protocol-and-validation.md).
Audit and verify the assembled contracts, not a live multiplayer implementation.

## Work

1. Reconcile every reviewed T13.1 message with exported types, validators, public
   projection, private boundaries, and error/revision/ID documentation. No schema
   should be only a TypeScript assertion or admit unvalidated nested payloads.
2. Add deterministic lifecycle contract tests: lobby create/join-shaped fixtures,
   shuffle/start, every match phase, bid/reduction requests, attempt actions,
   round continuation, final results, return to lobby, and existing-seat resume.
   Round-trip requests/replies through the actual parsers; project real T11
   states where useful. Never expose private solver witnesses in public fixtures.
3. Include two-/six-player boundaries, a one-player lobby, host versus watcher
   requests, positive ties/all-zero results, and stale prior-match/attempt context.
   Explain which are valid message shapes but require later domain rejection.
4. Audit malformed JSON, version mismatches, extra/forbidden fields, numeric and
   string boundaries, oversized collections, unknown enums, nested private-field
   injection, and errors containing secrets. Confirm bounded parsing behavior and
   the documented transport checks still required before parsing raw bytes.
5. Verify shared code has no React/Cloudflare/browser/timer/storage requirement
   and workspace dependencies remain acyclic. Prefer type-only imports for types;
   avoid pulling server solver execution into ordinary client parsing.
6. Write a concise shared-package README covering entry points, safe example
   messages, public/private data, validation versus authorization, trusted context,
   IDs/revisions, and which integration responsibilities belong to T14–T18.
   Update this parent/subtask status and the T13 roadmap entry with real evidence.
   Update architecture only to reflect reviewed decisions, not speculative ones.

## Verification

Run focused shared tests/type checks, then workspace tests, workspace type checks,
production build, and whitespace checks including new files. Record actual test
counts and any blockers. Do not rerun solver benchmarks unless solver behavior
changes or a specific measured concern warrants it.

No browser smoke/E2E claim is necessary for pure contracts. Do not mistake fixture
round-tripping for two browsers playing together, credential authentication,
retry deduplication, durable deadlines, or reconnection working in production.

## Acceptance and T14 handoff

- Reviewed protocol is implemented and covered by meaningful runtime tests.
- Every current player interaction has a defined request/response path or an
  explicit reason it remains server-only/deferred.
- Public serialization cannot leak credentials, hashes, proofs, or private
  preparation state; validators safely reject unsupported/malformed data.
- T14 can implement bootstrap, seat establishment, lobby snapshots/shuffle, and
  authenticated room commands without guessing the message contract.
- List unresolved server decisions honestly: deployment/runtime setup, credential
  generation and storage, deduplication/persistence, alarms, live solver runtime
  and recovery, departure/host continuity, and client reconciliation.

Do not begin T14, change UI/gameplay, deploy, or commit automatically.

## Audit outcome

No runtime defect or protocol change was required. The audited source matches
the approved 15 client request kinds and eight server message kinds. Only two
cross-contract lifecycle tests were added; existing exhaustive individual boundary
tests were reused instead of duplicating their matrices.

| Area | Implementation and evidence |
| --- | --- |
| Client inventory | `clientRequests.ts` / `parseClientRequest.ts`; all bootstrap/lobby/bid/attempt/skip/continue/lobby-return requests in `parseClientRequest.test.ts` |
| Server inventory | `serverMessages.ts` / `parseServerMessage.ts`; all eight reply kinds, bounded reason vocabularies and exact keys in `serverMessages.test.ts` |
| Public phase states | `publicState.ts`, projection/parser helpers; all six phases, room statuses, one-player lobby, two-/six-player matches, ties/all-zero scores in `publicState.test.ts` |
| Privacy | Explicit owned projection; nested fake credentials/proofs/history never copied; unknown received fields/accessors/hidden data rejected; safe bounded errors and broadcast-only parser tested |
| Versions and limits | Exact v1, canonical IDs/text, integer/enum/context validation, pre-JSON 4 KiB client / 64 KiB server UTF-8 caps, bounded arrays and dense catalog fixture size checks |
| Revisions/retries | Reviewed result fields and stateless original/retry/conflict/late/stale/out-of-order/new-lobby examples; persistence/identity/reconciliation explicitly left to server/client tasks |
| Composition | New `protocolFlow.test.ts` two-/six-player scripts round-trip requests/replies around actual T11 ten-round progression and real bounded target preparation |
| Boundaries | Six workspace dependency manifests form an acyclic graph; shared production source has no platform/timer/network/storage/solver imports; ES2022-only package type checking passes |

The composition tests exercise one-player creation-shaped state, join-shaped
replies, preview shuffle/start, Preparing/Thinking/Bidding, higher competing bids
and own reductions with original tie priority, server-controlled expiry,
active/watcher permissions, no-op/Undo/Reset, Give Up rollback/exhaustion,
verified success/carry-forward, host skip, Continue/Finished, positive shared
scores, private resume/binding replies, stale contextual request shape, and
New Match lobby return. Private witnesses remain test-only. The harness supplies
trusted actors/time and manually simulates room-only fixture transitions: it is
not an authenticated transport, production room handler, dedup store or reconnect
implementation. Old contextual requests can parse; later handlers must reject
them against current authoritative context.

## Verification evidence — 2026-10-27

- Focused shared tests: 378 passed (184 request + 58 snapshot + 133 reply +
  2 lifecycle + 1 public-entry test).
- Workspace tests: 922 passed across all six test packages.
- Workspace TypeScript checks and production build: passed.
- Workspace dependency/source audit: passed after accounting for manifests
  without dependency sections; no runtime rule fix was needed.
- Whitespace and local documentation links: checked, including new files.
- No browser, socket, Worker, credential verification, restart/durable retry,
  mobile reconnect or deployment evidence is claimed. Solver unit tests ran as
  part of the suite; benchmarks were not rerun because solver behavior did not change.

## Handoff

`packages/shared/README.md` documents entry points, a safe example request,
public/private boundaries and T14–T18 responsibilities. The approved T13.1 draft
remains the precise message inventory. T14 must settle credential lifetime/storage,
secure local testing, room-code routing/collisions, bootstrap/room atomic persistence
and replay capacity. Live solver runtime/recovery still gates T15; disconnect,
multi-tab, host continuity, permanent departure and expiry rules still gate T17.
No unresolved transport behavior was silently implemented here. T14 requires a
separate request; no runtime/UI/infrastructure changes or commit were made.
