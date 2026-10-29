# T14.1 — Server Design and Local Development Setup

## Status and purpose

Design approved by the owner; local scaffolding implemented. First checkpoint
in [T14](T14-room-creation-seats-and-invite-flow.md). HTTPS/device verification
remains pending separate certificate permission/setup, not silently waived.
Finalize the smallest safe implementation design, then establish local Worker/
Durable Object development and tests. No real room/authentication handlers yet.

## Design review before implementation

Record a concise proposal in this task or a directly linked design document:

1. Registry versus Room object ownership: private session/verifier/expiry data,
   code mappings, create reservations, room roster/board/revision and scoped replay
   records. Confirm lookup identities and persisted schema versions.
2. Fixed 24-hour session semantics: server clock, issue/expiry/revocation fields,
   valid-cookie reuse without sliding renewal, and handling expiration on existing
   sockets. No automatic transfer of an expired identity's seat by nickname.
3. Code reservation -> idempotent room initialization -> published mapping/reply:
   explain recovery at every interruption, concurrent create/join behavior, and
   ownership checks. Do not promise a transaction spanning multiple objects.
4. Command-ID scope/canonical payload comparison, atomic outcome/revision writes,
   replay retention/capacity and fail-safe exhaustion/cleanup. Agree concrete
   bounds before implementing them; room expiry remains a T17 policy.
5. Session verification/revocation access on HTTP/WS, private internal object
   calls, Origin/content-type/size/rate protections, and safe logging/errors.
   The registry must not become a publicly callable identity-forging endpoint.
6. Minimal connection semantics needed at T14.5: repeated tabs do not allocate
   seats or incorrectly mark a seat disconnected while another valid socket
   remains. Identify what needs a small agreed initial policy versus T17's
   later multi-tab takeover/host/grace rules.
7. Route/unsupported-command behavior for partial checkpoints using existing T13
   shapes. Define how a browser can exercise bootstrap/socket calls before UI.
8. Local frontend/server same-origin HTTPS/proxy arrangement and permitted Origins.
   Explain local persistence, restart versus reset, Windows/Android certificate
   requirements, secrets/private-key exclusions, and cleanup. No public tunnel.

Ask for review of consequential security/storage/resource choices before coding.
Use current official Cloudflare documentation when selecting runtime tooling/APIs.
Do not silently add another database/service or rewrite the protocol.

## Approved design

The owner accepted this design in discussion. Approval does not mean all the
behavior below is already implemented: session, creation, membership and socket
handlers remain T14.2–T14.5. T14.1 implements only the local scaffolding/setup.

### Storage and identities

- Use two SQLite-backed Durable Object classes: `Registry` and `Room`. Use one
  stable named Registry instance per environment; address each Room by a
  server-generated UUID. Keep local/test/production namespaces separate.
- Registry owns private session records, room-code mappings, creation reservations
  and creation replay records. Session records contain an internal UUID,
  SHA-256 credential verifier, issued/expiry timestamps and optional revocation
  timestamp. Generate credentials from 32 cryptographically random bytes; never
  persist the raw cookie or include it in JSON/logs.
- Room owns its room UUID/code, schema version, lobby UUID, selected catalog board,
  host seat, ordered roster, private session-to-seat mapping, revision and scoped
  command outcomes. Later match state belongs here, not in Registry.
- Start persisted schemas at version 1. Initialize/migrate before handling work;
  reject unknown newer schemas without overwriting them. Persist state, revision
  and command outcome in one object-local transaction before acknowledging or
  broadcasting. Never hold a transaction open over another object's call.
- Use typed internal Durable Object calls through bindings. The public Worker
  exposes only approved routes, not arbitrary Registry/Room methods. No client
  header or body may supply a trusted session/seat identity.

Cloudflare recommends SQLite for new namespaces, and each object's storage is
private and transactional; this does not create cross-object transactions.
[Storage reference](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/).

### Session enforcement

- `POST /api/session` issues or reuses the approved HttpOnly/Secure/SameSite=Lax,
  host-only `__Host-rr-session` cookie. Server time defines
  `expiresAt = issuedAt + 86_400_000`; invalid at or after that instant.
- Refresh/activity/resume do not move expiry. Reusing a valid cookie must not reset
  its browser lifetime to another 24 hours. An invalid/expired cookie can establish
  a new identity through this route, never inherit the old identity's seats.
- Verify sessions at every authenticated HTTP call and WebSocket upgrade. At the
  live-lobby checkpoint, also verify before executing socket commands and before
  sending private/public room state to that socket. Fail closed on verification
  failure; a Registry outage must not become permission to mutate.
- Store socket session ID and hard expiry privately. Schedule expiry handling and
  close expired sockets; enforce expiry again on every use, because scheduled
  callbacks are not an exact security boundary. Revocation is checked through
  Registry, not trusted from a browser. No new public logout/revocation endpoint.
- Session expiry is NOT room expiry. It does not erase a room, transfer its host,
  or make an old seat claimable by nickname. Host/grace/room-expiry policies remain
  T17 work; this checkpoint is not a complete lifecycle implementation.

### Crash-safe room creation

1. Authenticate and normalize the request. Atomically reserve a unique six-character
   code and room UUID, bound to `(sessionId, commandId)` and canonical payload.
2. Call Room initialization with that reservation's immutable ID/owner/board data.
   Initialization atomically creates the host seat and initial lobby once. Repeating
   the identical initialization returns the same seat; conflicting input fails.
3. After Room confirms durable initialization, Registry atomically publishes the
   code mapping and records the completed creation outcome. Only then reply.

A crash before reservation leaves nothing. A crash after reservation or Room
initialization leaves recoverable pending work: the same request resumes the same
UUID, code and host seat. A lost final reply replays the completed result with
current state. Concurrent retries converge; a conflicting reuse of the ID fails.
Join never exposes a pending room: return `temporarily-unavailable` until creation
finishes. On restart, recover pending reservations on retry and through bounded
maintenance batches; do not delete/reassign them merely because they are old.
An irrecoverable inconsistency fails closed for investigation, rather than creating
a replacement room under the same command. Do not claim global atomicity.

Room join/resume transactions belong entirely to Room after authenticated Registry
lookup. Re-check existing membership before capacity/match-lock checks. Concurrent
joins cannot exceed six seats. Existing members recover their original nickname
and seat; new identities cannot join a started match.

### Retries, retention and proposed safety bounds

- Creation IDs are scoped to session plus Registry destination; room commands to
  session plus room destination. Compare canonical normalized envelopes, including
  command kind and context. Property order is insignificant; do not normalize away
  meaningful differences. Replay lookup precedes evaluating a duplicate as new.
- Persist accepted/no-op/domain-rejected outcomes with the corresponding revision.
  Duplicate results preserve their original processed revision and report current
  revision/state separately. Read-only snapshots do not increment revision;
  connection-status changes do when their public value actually changes.
- Retain room replay records for the room's lifetime. Never evict old records and
  later execute their IDs as new. Expired-session private Registry data can be
  cleaned after expiry; room membership/history is not deleted as a side effect.
- Proposed initial caps: 1,000 retained room reservations/mappings per environment,
  10,000 unexpired sessions, 20 creations per session lifetime, 100,000 replay
  records per room and 10,000 per session per room. Count pending reservations too.
  These are conservative private-test safety limits, not provider quotas.
- Proposed durable request budgets: session issuance 60/minute globally; bootstrap
  create/join/resume 30/minute per session, with creation additionally 5/minute;
  socket input 120/minute per session per room. Use server-clock fixed windows;
  duplicate requests still consume rate budget. Do not trust forwarded client IP
  headers from the local browser/proxy. These are not production DDoS protection.
- At rate limits use existing bootstrap `rate-limited`; at storage/replay capacity
  use bootstrap `temporarily-unavailable`. For socket backpressure/capacity, close
  with 1013 before applying a new command, retaining existing records/state.
  Existing replay lookup remains possible when record capacity is exhausted.
  Do not invent a T13 command rejection reason. Cleanup of live rooms or a new
  in-room rate-limit reply requires a later explicit policy/protocol decision.

### HTTP, socket and partial-checkpoint behavior

- Exact configured Origin allowlist for bootstrap POST and socket upgrade; reject
  missing/untrusted Origins, including lookalike hosts. No permissive CORS.
  Require JSON content type for command POSTs; enforce T13's 4 KiB raw request
  limit before parsing and 64 KiB server-message bound. Reject binary WS commands.
- Bind each accepted socket to authenticated room/session/seat server-side. Multiple
  tabs share one seat; initially allow at most four sockets per session per room,
  rejecting the fifth rather than silently replacing another tab. A seat is
  connected while any unexpired valid socket remains. Closing one of several
  sockets must not mark it disconnected. Persist connection changes and reconcile
  against restored live sockets after runtime restart; never trust a stored `true`
  alone. Advanced takeover and grace/host transfer remain T17.
- Re-check ownership and lobby phase for shuffle; publish only projected public
  snapshots. Never broadcast cookies, internal session IDs, replay records or solver
  proofs. Logs use error category/room UUID/revision only, not headers/raw messages.
- Implement routes incrementally: session in T14.2, create in T14.3, join/resume
  in T14.4, authenticated sockets/state requests/shuffle in T14.5. T14.1 has only
  a development health check and tests that call object bindings directly; no
  public seed/reset/internal-object diagnostic endpoints.
- Until a handler exists, return HTTP 503 for its known route without changing
  state. At the partial socket checkpoint, well-formed commands whose handlers are
  deferred (including Start/gameplay) close with 1013 without execution. Malformed
  messages still use T13 protocol errors. This is a temporary developer checkpoint,
  not a new product-level `wrong-phase` rule or a claim of live gameplay support.
- Exercise bootstrap with same-origin browser `fetch` and sockets with `WebSocket`
  in developer tools; the browser carries its cookie automatically. Different
  browser profiles/devices provide distinct players. Never copy credentials by hand.

### Local tooling and HTTPS

- Keep the existing React/Vite app. Add Wrangler for a separate loopback Worker
  on port 8787, SQLite-backed object bindings and generated Worker runtime types.
  Use Cloudflare's Vitest Workers integration compatible with the workspace's
  Vitest version; check package compatibility before installation. No extra DB,
  Cloudflare Vite plugin or production deployment is needed for this setup.
- Vite remains the browser entry on port 5173. An explicit HTTPS development mode
  reads local certificate paths and proxies `/api` HTTP and WebSocket requests to
  the loopback Worker. The browser only sees one HTTPS/WSS origin. Preserve ordinary
  local UI development; do not silently fall back to HTTP for cookie-auth testing.
- Configure allowed Origins explicitly, for example `https://localhost:5173` and
  the owner's actual LAN-IP origin. Do not hardcode the current LAN IP or allow
  arbitrary LAN hosts. Bind Worker/debugging endpoints to loopback; only Vite's
  explicitly enabled phone-testing mode listens on the LAN.
- Recommend a locally generated development CA and a certificate containing
  localhost, loopback and the current PC LAN IP (for example with `mkcert`). Creating
  or trusting this CA is a separate approval step. Android needs only the public
  CA certificate trusted; never transfer the CA private key. Test on the owner's
  Android first, not the friend's iPhone. Document trust removal and IP changes.
- Ignore `.wrangler/`, local certificate/key directories and `.dev.vars*` except a
  secret-free example. Store no CA keys in the repository, even ignored. Do not
  log cookie headers. Keep a stable local persistence directory across restarts;
  tests use isolated storage, not the developer's rooms. Document a narrowly scoped
  reset procedure but never run deletion automatically.

Wrangler runs a local runtime with local bindings; its default local data is under
`.wrangler/state`. Restarting and explicitly deleting that data are different
operations. See [local runtime](https://developers.cloudflare.com/workers/local-development/)
and [local persistence](https://developers.cloudflare.com/workers/local-development/local-data/).

### Implementation files and verification after approval

Likely files: `apps/server/src/index.ts`, small Registry/Room modules and smoke
tests, server Wrangler/Vitest/TypeScript/package configuration, pnpm lockfile,
`apps/web/vite.config.ts`, `.gitignore` and a local-development guide. Do not add
session or real room handlers until their respective subtasks.

Verify startup/health, both object bindings, isolated storage, persistence across
runtime restart, server type checks/tests and existing web checks. Verify HTTPS
proxying only after certificates are supplied/approved; report Android checks as
pending until actually performed. No certificate trust, firewall changes or
deployment is authorized by approving code scaffolding alone.

## Setup work after review

- Add minimal Worker entry/bindings and Registry/Room class scaffolding with the
  local runtime configuration and suitable integration-test tooling. Existing
  server code is currently only a placeholder; keep dependencies justified.
- Add local scripts and documented same-origin routing with the existing web
  development setup. A simple health/smoke path suffices at this checkpoint.
- Configure persistent local emulation of the approved object storage. Keep
  local data, secrets, keys and generated certificates out of Git; never delete
  unrelated state. Document any reset command rather than running it automatically.
- Describe certificate creation/trust/removal separately. Do not modify device
  trust stores, install certificates, open firewall ports, access a Cloudflare
  account or deploy without specific authorization. Ordinary existing HTTP board
  testing is not proof that Secure-cookie authentication works.

## Acceptance and checks

- Local Worker starts; a scoped health path and bound-object smoke test work.
- Integration tests can run against the intended local runtime without deployment.
- Reviewed persistence/identity/replay/security decisions are recorded and testable
  in the following tasks; no unfinished policy is disguised as a coding default.
- Frontend local simulation is preserved. No create/join/product UI or game logic
  changes, authentication implementation or live gameplay in this checkpoint.
- Relevant tests/type checks/build and whitespace checks run; report unavailable
  device trust/HTTPS smoke checks honestly. Stop before T14.2 until requested.

## Implementation record

- Worker entry exposes local-only `GET /api/health`; known deferred routes return
  503 and internal/seed/reset routes are not exposed. No auth/session/room handlers.
- Registry and Room initialize version-1 SQLite metadata, fail on unsupported
  versions and expose only a binding-private schema read for smoke tests.
- Wrangler, runtime types and Workers integration tests are configured. Pinned
  Node-20/Vitest-3-compatible tooling uses the supported legacy SQLite migration
  format; current `exports`/new test-plugin tooling needs a separate upgrade.
- Vite proxies `/api` and upgrades without rewriting Origin. Explicit HTTPS mode
  reads supplied private paths and fails if certificates are absent. Existing UI
  and game logic are untouched. No credentials/certificates were created.
- Local startup, direct/proxied HTTP health and the existing web entry were
  checked. Tests cover object/storage isolation, schema handling and full runtime
  shutdown/recreation with persisted data. See [local development](../local-development.md)
  for commands, limitations and certificate/reset instructions.
- Windows Workers-adapter temporary-file cleanup can warn `EBUSY` after passing
  assertions; dedicated restart-test storage cleanup succeeds. Do not suppress
  this by deleting broad temporary directories.
- HTTPS/WSS and Android checks are pending actual approved certificate setup.
  The socket proxy is configured, but a real authenticated socket is T14.5 work.
- Verification on 2026-10-28: workspace tests passed (938 at the full run),
  workspace type checks and production build passed. The final added local-mode
  guard test then passed with all 18 server tests and server type checks (939
  tests in the resulting workspace). Tracked/new-file whitespace checks passed.
  Direct Worker health, Vite-proxied health and web entry returned 200; explicit
  HTTPS startup without certificate configuration failed as intended. Temporary
  development servers were stopped. No commit or deployment was performed.
