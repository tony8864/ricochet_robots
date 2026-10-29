# T14.2 — Fixed-Lifetime Browser Identity

## Status and dependency

Implemented after [T14.1](T14-1-server-design-and-local-setup.md) design/setup approval.
Real HTTPS/browser/Android cookie verification remains pending certificate setup.
Follow the [parent](T14-room-creation-seats-and-invite-flow.md) and T13 contracts.
Implement anonymous browser identity only, not room membership or accounts.

## Work

1. Implement `POST /api/session` for validated `session.open`. Issue an unpredictable
   server-generated credential with at least 256 random bits; persist only its
   approved lookup/verifier representation and private metadata in registry storage.
2. Set `__Host-rr-session` via Set-Cookie with Path=/, Secure, HttpOnly,
   SameSite=Lax, no Domain and **Max-Age=86400** at initial issuance. Persist server
   issue/expiry times; authorization expires at issuedAt+86,400,000ms.
3. Reuse a valid credential without renewing its cookie/server deadline. Opening
   the app, refreshing, resuming, or activity cannot silently extend the fixed
   lifetime. Handle missing/invalid/expired cookies using the reviewed design;
   a newly issued identity never inherits an old seat from its nickname.
4. Provide the server-only verification seam later HTTP/WS routes use. Enforce
   absolute expiry and recorded revocation using server time; never trust browser
   timestamps. No public logout/recovery/rotation command is introduced by this task.
5. Apply reviewed exact Origin, JSON content-type, bounded raw body, parsing and
   session-creation resource protections. Return `session.ready`/reviewed errors,
   never JSON token fields, cookie echoes or sensitive debug logs.
6. Keep clocks, secure randomness and storage injectable at appropriate test seams;
   actual issuance uses secure server facilities, not deterministic test IDs.

## Tests and acceptance

- Valid issuance/cookie attributes/private record and correct 24-hour expiry.
- Same valid cookie reuses identity with unchanged expiry/Set-Cookie behavior.
- Boundary checks just before expiry versus exactly at/after it, with controlled
  time, including a cold object/restart reading persisted session state.
- Random/tampered/unknown/revoked credentials fail verification; malformed or
  duplicate/ambiguous cookie fields follow the reviewed fail-closed parsing rule.
- Bad Origins, content types, oversized/malformed messages and resource limits
  fail safely with no token disclosure. Cookie scope/auth verification is distinct
  from T13 structural validation.
- Two independent cookie jars establish distinct identities; same browser profile
  reuses its identity. No seat is created at session establishment.

Run focused server/runtime tests and type checks, with relevant workspace checks.
Record secure local browser smoke evidence if available; HTTP-only or mocked
header tests do not prove Android cookie handling. No UI, room creation, socket
handler, session rotation flow or certificate installation is implied. Stop here.

## Implementation and verification

- `src/sessionRoute.ts` implements only `POST /api/session` with T13 request parsing
  and typed private replies. Origin must exactly match a canonical configured
  HTTPS origin. Non-POST methods, non-JSON requests, oversized declared/streamed
  bodies, invalid UTF-8 and wrong commands fail before issuance. No permissive CORS.
- Registry owns `browser_sessions` and a durable singleton issuance budget. Tokens
  contain 32 cryptographically random bytes, hex encoded; only SHA-256 verifiers,
  private session UUIDs and issuance/expiry/revocation metadata are persisted.
  The existing schema-1 scaffold is extended additively with session tables; Room
  storage receives no session table or seat allocation.
- `verifySession` is a binding-private seam, not an HTTP endpoint. It rejects
  unknown/malformed credentials, revoked records and times at/after absolute
  expiry. `SessionStore` permits controlled clock/randomness tests; production
  RPC accepts no client clock, expiry, session UUID or random seed.
- Valid-cookie reuse sets no new cookie and keeps the original deadline. Invalid,
  unknown, expired or revoked single credentials can establish a new identity,
  without recovering any old seat. Duplicate session fields (including combined
  cookie headers) fail with `not-authenticated`, never first/last-cookie selection.
  Oversized/ambiguous headers fail closed; encoded/quoted tokens are not decoded.
- Issuance atomically enforces 60/minute globally and 10,000 unexpired sessions.
  Existing valid identities remain reusable at exhaustion. Capacity/collision
  failures never evict live records. Cleanup removes at most 256 expired private
  records per issuance, not room memberships. Rate/capacity replies use T13 reasons.
- Anonymous initial bootstrap has no authenticated identity until its Set-Cookie
  reaches the browser. A lost first response or concurrent cookie-less opens can
  leave an unused expiring record; a command UUID alone cannot recover a credential.
  Clients should serialize initial bootstrap. Retrying with a valid cookie reuses
  it. No raw credential is stored to replay a lost Set-Cookie response.
- Tests cover issuance/privacy, cookie attributes, independent jars/reuse,
  controlled expiry boundaries and revocation, input/Origin/body protections,
  concurrent issuance/rate/capacity/collision handling and server failure replies.
  The full runtime-restart test now also checks persisted identity immediately
  before expiry and rejection exactly at expiry, without real-time sleeps.
- Runtime/header tests are not evidence of browser cookie storage. No certificate
  was generated or trusted; no Android, browser-cookie, WSS, room or UI completion
  is claimed. Toolchain/Windows cleanup limitations remain as documented in
  [local development](../local-development.md).
- Verification on 2026-10-28: all 57 server tests / 978 workspace tests passed,
  workspace type checks and production build passed. Real browser-cookie and
  Android checks remain pending, not substituted with HTTP header assertions.
