# T13.2 — Client Request Contracts and Validation

## Status and dependency

Implemented and verified on 2026-10-26 after owner approval of
[T13.1](T13-1-message-inventory-and-protocol-design.md).
Read the [parent](T13-typed-protocol-and-validation.md) and approved design.
Implement only the client-to-server request boundary in `packages/shared`.

## Work

1. Add readonly discriminated request types and common envelope/identifier
   contracts matching the reviewed design. Separate create/join/reconnect shapes
   from authenticated in-room player requests.
2. Reuse appropriate public engine/match command types without exposing
   `MatchAction`, trusted actor/host/time context, or internal controller commands
   as valid client messages. Keep dependency direction acyclic.
3. Implement pure validators/parsers from `unknown`; handle malformed JSON through
   the approved parsing API without unsafe type assertions substituting for
   validation. Return bounded, stable errors rather than raw payloads/exceptions.
4. Validate every required nested value, enum, positive safe-integer bid,
   command identifier, contextual identity, string limit, and approved property
   policy. Apply normalization only where reviewed; do not coerce string bids
   or silently invent defaults for missing security/context fields.
5. Enforce the approved structural/collection bounds and make clear which raw
   frame/byte-size checks must occur in the future transport before JSON parsing.
   Validation is not a substitute for transport limits or rate limiting.
6. Export only the reviewed request types, parsing API, and reusable constants
   through the public shared entry point. Keep implementation portable and small.

## Tests and acceptance

- A representative valid fixture for every supported request parses and narrows
  to its TypeScript variant; JSON round-tripping preserves its meaning.
- Reject unknown versions/types, null/arrays in place of objects, missing/extra
  fields according to policy, bad enums, oversized strings, and invalid contexts.
- Reject zero, negative, fractional, string, non-finite, and unsafe-integer bids.
  Accept valid bids without imposing a comparison to another player's value.
- Inputs cannot smuggle actor/host authority, timestamps, scores, robot positions,
  solver output, timer expiry, or internal preparation operations into requests.
- Test the limit boundaries and malformed JSON without real clocks or sleeps.
  Parsers do not mutate input and error results never echo credentials.
- A parsed request is explicitly not authenticated or authorized. Do not duplicate
  phase/turn/bid-order rules in the parser; later server handlers enforce them.

Run shared tests and type checks, plus checks for affected workspace dependencies.
Update the existing scaffold-only shared entry-point test to assert the intended
public API rather than an empty module. No server handlers or UI wiring yet.

## Implementation and evidence

`packages/shared/src/clientRequests.ts` defines the readonly 15-variant request
contract and limits. `parseClientRequest.ts` exposes `parseClientRequest(unknown)`
and `parseClientRequestJson(unknown)`, returning an owned normalized value or a
bounded error code. Internal helpers validate exact own data properties, reject
classes/accessors/symbol/hidden/extra fields, check UUID/context/numeric boundaries,
and count UTF-8 bytes without DOM or Node APIs. Errors do not expose input.

`parseClientRequest.test.ts` adds 184 tests; the updated public-export test makes
185 shared tests. Coverage includes every request, JSON round-trips, missing/extra
fields at all object levels, wrong context, Unicode/code normalization and limits,
enum/confirmation/bid boundaries, spoofed authority, internal operations, and
getter/prototype inputs. Engine enums and existing match player-command types are
reused through two workspace dependencies; match imports are type-only.

All 729 workspace tests, workspace type checks, production build, and offline
frozen installation passed. This does not implement authentication, context-to-
state comparison, authorization, actual deduplication, or raw transport limits.
No server/UI changes, gameplay deviations, external libraries, or commits.
