# T14.6 — Create and Join Room UI

## Status and goal

Visual checkpoint T14.6.1 reviewed by the owner. Create Room checkpoint T14.6.2
implemented and owner-confirmed working on the phone after restarting the backend
with its configured Origin. Join Room checkpoint T14.6.3 implemented; two-device
UI Create/Join now confirmed working by the owner between phone and PC. Broader
final verification T14.6.4 remains pending. Follows T14.1–T14.5 in
[T14](T14-room-creation-seats-and-invite-flow.md).

Let a player enter a nickname and create a private room or join by code using
normal UI instead of browser-console commands. Reuse the existing authenticated
HTTPS endpoints and T13 contracts. This task ends at validated room entry, not
a connected lobby or a playable networked match.

Read `AGENTS.md`, `docs/product.md`, `docs/architecture.md`,
`packages/shared/README.md`, the approved T13.1 protocol design and
`docs/local-development.md` before implementation.

Implement one checkpoint at a time and stop for owner review. This document
does not authorize implementing all checkpoints in one pass.

## Boundaries

- Keep the existing local match simulator accessible through an explicit
  development-only entry. Keep its controller and Act as controls separate from
  authenticated room mode; never use them to choose a network identity.
- Use same-origin HTTPS, browser-managed HttpOnly cookies and existing server
  routes. Do not put credentials in React state, URLs, logs or browser storage.
- Client validation improves feedback; the server still owns membership,
  capacity, host identity, room locking and the fixed 24-hour session lifetime.
- No new server commands, gameplay rules, dependencies or infrastructure.
- T14.7 owns the live board/roster, WSS binding, room-code/link sharing controls,
  host Shuffle wiring and connection feedback. T14.8 owns live Start locking.
- Automatic reconnect/background recovery belongs to later work. Do not claim
  an HTTP entry snapshot is a live synchronized lobby.

## Ordered checkpoints

### T14.6.1 — Entry screen, visual only

- Add a small mobile-first entry screen matching the existing minimal dark-blue
  and yellow UI. Include a labeled nickname input, Create Room action, and a
  Join Room section with a labeled room-code input and Join Room action.
- Use a compact centered content column, safe-area-aware spacing and touch
  targets of at least 44×44px. Keep the form usable with the phone keyboard open;
  scrolling is allowed rather than clipping inputs or actions.
- Provide visible keyboard focus, associated labels and accessible validation/
  status regions. Do not rely on placeholders or color alone.
- Buttons perform no real room mutations yet. Make the visual-only state clear;
  do not display fake success or a fake connected lobby.
- Preserve access to the development simulator without exposing it in production.

**Review:** owner approves the entry layout on narrow phone and desktop widths
before adding network behavior.

### T14.6.2 — Browser session and Create Room

- Add a small typed HTTP adapter under `apps/web/src`, separate from presentation
  and the local controller. Reuse shared request and server-message validators.
- On submission, bootstrap/reuse identity through `POST /api/session`, then send
  `room.create` to `POST /api/rooms` using the normalized nickname. Serialize
  initial session bootstrap within this app instance; never read the cookie.
- Reuse shared nickname constraints/normalization rather than duplicating or
  inventing a different nickname policy. Duplicate nicknames remain allowed.
- Correlate validated replies with the pending command and expected message type.
  Handle HTTP failures, malformed/unexpected replies and network failures safely.
- Keep one immutable payload/command ID per logical submission. Disable duplicate
  submissions while pending. An explicit retry after an ambiguous lost reply must
  reuse that payload/ID; never silently create a second room. A deliberate new
  action uses a fresh ID, and an edited payload cannot reuse the previous ID.
- After validated `room.entered`, show a minimal room-entry confirmation with the
  actual room code and own nickname. Retain the private recipient binding and
  full public state for the T14.7 handoff; do not derive host/seat from nickname.
  Clearly say the live lobby is the next checkpoint, not already connected.
- Do not fabricate local players, open a local match or start a game on success.

**Review:** create a real room from the UI in one desktop browser and confirm
its code and membership against the existing backend.

### T14.6.3 — Join by code and invite navigation

- Wire Join Room through session bootstrap and `POST /api/rooms/join` with
  `room.join`. Apply shared room-code normalization and validation; preserve
  safe nickname/code drafts when submission fails.
- Use the same pending, parsing, correlation and exact-retry behavior as Create.
  Respect an existing member's server-returned seat/nickname rather than treating
  a changed input nickname as a seat rename or a new player.
- Support a code-only invite URL that pre-fills the form, using a simple
  owner-approved same-origin `/room/ABC234` path convention.
  Opening a link must not automatically allocate
  a seat: the player reviews the nickname and presses Join Room.
- Treat invite-path input as untrusted. Invalid codes show form feedback, never a
  request to an arbitrary origin or a credential/seat override. Do not add link
  sharing buttons here; T14.7 will generate links using this convention.
- Show safe, actionable messages for the actual protocol errors: unavailable/
  unknown room, full room, locked match, invalid/expired session, rate limiting
  or temporary service failure. Do not invent wire error codes or echo raw errors.
- Never automatically replace an expired identity and rejoin under a new seat.
  Explain the problem and require an explicit user action for a new session.
- Remembering a nickname is optional convenience only, not proof of identity.
  Do not add persistent room recovery or automatic retries as an implicit feature.

**Review:** two isolated browser identities create/join the same room from real
buttons; entry confirmations identify the correct room and distinct seats.
Ordinary tabs sharing a cookie are the same identity, not two test players.

### T14.6.4 — Verification and T14.7 handoff

- Add focused UI/adapter tests with controlled replies for input normalization,
  pending/disabled states, safe errors, malformed/mismatched replies and stale
  responses after navigation or a newer submission.
- Verify an ambiguous retry uses the original ID/payload and cannot create
  duplicate rooms/seats. Test explicit new actions, existing-member join and
  expired-session handling without silently replacing identity.
- Test invite prefill, invalid path input, keyboard submission and accessible
  labels/status messages. Keep the existing local simulator tests passing.
- Exercise actual frontend-to-Worker create/join over approved same-origin HTTPS
  with two isolated desktop identities; use existing server tests for authoritative
  capacity, locking and persistence rules rather than duplicating them in UI.
- Run relevant web tests/type checks, workspace integration checks as appropriate,
  production build and `git diff --check`. Record commands/results and limitations.
- Check narrow phone layouts. Real Android/iPhone checks require working HTTPS
  trust; UI does not remove that requirement. The owner reinstalled the phone's
  development CA and confirmed Create works. Do not alter firewall/trust settings,
  create a tunnel or deploy without separate permission. Record unavailable
  physical-device checks honestly.
- Document the entry-to-lobby handoff: validated room ID/code, own seat binding
  and authoritative snapshot. T14.7 must establish WSS and reconcile its current
  snapshot before presenting connected room actions.

## Likely files

- `apps/web/src/main.tsx` and a small entry/app boundary as needed.
- New entry form and minimal confirmation components with focused tests.
- A small HTTP/session adapter with tests, separate from `src/local`.
- `apps/web/src/styles.css` for scoped entry styles, preserving existing views.
- Local development notes only where needed for the new UI testing procedure.

Inspect current conventions first; these are responsibility boundaries, not a
requirement to create a routing framework or broadly refactor existing screens.

## Completion and stop point

A player can create or join a real room through the UI, including invite-code
prefill, with validated membership, safe errors and retry behavior. The local
simulator remains separate and usable. Checks and actual browser/device evidence
are recorded, including any unavailable verification.

Stop before implementing T14.7's connected lobby, live Start, bidding or movement.
No commit, deployment or certificate changes without a separate request.

## T14.6.1 implementation record

- Root entry now renders `RoomEntry` in development and production. The existing
  local simulator is still development-only at `/?preview=local`, lazy-loaded
  only on that explicit entry. Game logic and board rendering are unchanged.
- Added scoped entry styling, shared-contract validation, best-effort nickname
  memory and approved `/room/ABC234` prefill. The 24-character limit counts Unicode
  code points as the protocol does, rather than HTML UTF-16 `maxlength` units.
- Valid actions show an inline preview-only notice. No HTTP requests, cookies,
  room allocation, connection states or simulated success are introduced.
- Reused `@robot-puzzle/shared` as an internal workspace dependency; no external
  package was added. Blocked/unavailable browser storage leaves the form usable.
- Verification: 135 web tests passed, including 10 new entry/helper tests;
  web TypeScript check and production build passed; `git diff --check` passed.
  Actual browser/keyboard/physical-phone visual review remains for the owner;
  static-render tests do not establish responsive layout or interaction behavior.

## T14.6.2 implementation record

- Added `src/entry/createRoomClient.ts`: same-origin cookie-managed session
  bootstrap followed by validated room creation. It validates replies, command
  correlation and creation membership, bounds response reads and uses a 15-second
  request timeout. No credentials, request IDs or room binding are persisted.
- `RoomEntry` subscribes to the flow, shows pending/error states, locks conflicting
  input/actions and retains the full validated membership/snapshot for T14.7.
  Success renders the real room code and server-returned nickname, explicitly
  labeled as a non-live confirmation. Join stays preview-only; no sockets or
  local-game actions were added. The owner's uppercase OR divider is preserved.
- Duplicate submissions share the pending operation. Ambiguous failure permits
  only explicit retry of the same ID/payload in the same in-memory identity flow;
  it never opens a fresh session before retrying a creation. Auth rejection blocks
  creation until an explicit Start a new session action resets bootstrap state;
  a subsequent Create uses fresh IDs. That action cannot restore previous seats.
- Retry recovery currently requires keeping this page open. Reload/navigation
  loses the in-memory request; durable client recovery and automatic reconnect
  remain out of scope. Do not describe a fresh creation after reload as recovery.
- Tests cover session ordering, normalized input, duplicate clicks, exact replay,
  fresh logical actions, expired-session consent, safe service errors, invalid/
  mismatched replies, bounded reads, timeout and subscriber cleanup. UI tests
  cover loading/disabled controls, inline retry/auth errors and confirmation.
- Verification: 160 web tests passed; web TypeScript check/production build
  passed. No server/game logic changed. Real browser-cookie/frontend-to-Worker
  UI and physical-device checks remain pending; mocked HTTP plus static markup
  tests are not claims of end-to-end verification.

## T14.6.3 implementation record

- Generalized the existing HTTP flow as `src/entry/roomEntryClient.ts` (and renamed
  its test file), sharing session bootstrap, bounded validation and retry behavior
  between Create and Join. No server contracts or game logic changed.
- Join sends normalized nickname/code to `POST /api/rooms/join` only on explicit
  submission. Valid `/room/ABC234` invitations still prefill without autojoining.
  Replies must match the command, requested code and joined/resumed membership.
- Loading, spinner and inline errors belong to the active action. Pending or
  ambiguous requests lock competing actions and drafts; retry preserves the exact
  original action/nickname/code/ID. Definitive room-not-found/full/started errors
  unlock drafts for a deliberate new request with a fresh ID. Expired identity
  still requires explicit new-session consent and never silently rejoins.
- Success uses the server-returned seat/name and shows Room joined or Welcome back
  for resumed membership. Host labeling comes from snapshot identity, not action
  or nickname. The complete validated snapshot remains available for T14.7;
  confirmation is explicitly not live and no socket is opened.
- Verification: 177 web tests passed; TypeScript/production build passed. New
  coverage includes normalized joins, exact lost-reply recovery, competing action
  suppression, existing-member names, room rejection correction, reply correlation,
  expired sessions and action-specific UI states. PC/phone join UI review remains
  pending; mocked transport/static markup do not certify browser-cookie behavior.
- The owner independently restored phone CA trust before requesting this checkpoint;
  this implementation did not install certificates or change Origins/infrastructure.
- Existing Worker session/membership integration suites were rerun: 61 tests
  passed. The Windows Workers runner emitted EBUSY temporary-directory cleanup
  warnings at shutdown, with exit code 0 and no failed assertions. No broad
  temporary-directory cleanup was attempted. `git diff --check` passed.

T14.7 now replaces the temporary confirmation with the shared connected lobby.
See [T14.7](T14-7-connected-lobby-ui.md) for implementation/verification boundaries.
