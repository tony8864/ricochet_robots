# Local server development

Current automated rendered-browser setup: see [Browser tests](browser-testing.md).
`pnpm test:e2e` starts its own isolated HTTPS runtime and does not require or change
the development servers/rooms described below. Historical checkpoint sections
retain their original scope; current gameplay/recovery behavior is tracked in tasks.

## What works through T14.5

The existing local game simulator is unchanged. A separate local Cloudflare Worker
now starts with SQLite-backed `Registry` and `Room` bindings. Registry implements
anonymous fixed-24-hour sessions and recoverable room creation. A created Room
persists its host, selected lobby board and up to six authenticated player seats.
Joining, explicit snapshot resume, authenticated live lobby sockets and host-only
board shuffle are implemented. Match start/gameplay and connected product UI are
not. The existing React game still uses its local simulator, not this network lobby.
There is no deployment, account login, external database or paid service involved.

## Start on your PC

From the repository root, in two terminals:

```powershell
pnpm --filter @robot-puzzle/server dev
```

```powershell
pnpm --filter @robot-puzzle/web dev
```

Open `http://127.0.0.1:5173` for the entry screen; the existing development
simulator is at `http://127.0.0.1:5173/?preview=local`. Open
`http://127.0.0.1:5173/api/health` to check Vite's proxy to the Worker. Expect:

```json
{"status":"ok","checkpoint":"T14.1"}
```

Worker HTTP listens on `127.0.0.1:8787`; debugging uses loopback port 9230. Vite
defaults to loopback port 5173 and fails if it is busy rather than switching ports.
Stop each terminal with Ctrl+C. Do not expose the Worker/debugger to your Wi-Fi or
the internet. The health response proves routing only, not multiplayer/authentication.

Vite forwards `/api` HTTP and WebSocket upgrades to the Worker without changing
the browser's Origin. Authenticated upgrades use that same origin and existing
browser cookie. No API proxy is installed in the production web build.

## HTTPS and Android: a separate permission step

### T14.6–T14.7 entry and connected lobby UI

With the Worker and HTTPS frontend running as described below, open the exact
configured origin (for example `https://localhost:5173`). Enter a nickname and
press **Create Room**. Expect loading feedback, then the connected lobby containing
the real room code, board and server-supplied roster. No console commands are
required to create or join.

In a second isolated browser profile or phone, open its configured HTTPS address,
enter a nickname and the created room code, then press **Join Room**. Alternatively,
open `/room/ABC234` with the actual code: it pre-fills but does not automatically
join. Create/Join now open the connected lobby with the board, roster and the room
code/Copy control at the top-right above the board. Returning members retain their
original seat/name. Wait for Connected before using host Shuffle; both devices
must receive the same board. Start requires a connected host and at least two
seated players. T14.8 enters Preparing on both devices, locks the board/roster and
rejects new identities joining afterward; existing identities retain their seats.
T15.2 now schedules bounded server preparation and broadcasts Thinking after a
verified target is committed. T15.3 now shows read-only Thinking with the server
target/positions and round heading. T15.4 enables Place Bid for all players; the
first accepted bid starts one server-owned 60-second countdown visible in the
header. Both devices receive the accepted bid roster; each player can lower their
own bid, not raise it. At expiry both see the first demonstrator/bid/zero moves.
Movement/scoring controls are intentionally absent until T16.
A disconnected lobby
offers explicit Reconnect without opening a new session or allocating a seat.
Ordinary tabs in one browser share identity and do not simulate separate players.

If the connection fails or the reply is lost, keep the page open and use
**Retry Create Room** or **Retry Join Room**. It retains the original request
ID/nickname/code/action; do not reload
or navigate away expecting that in-memory retry to survive. An expired identity
requires explicit **Start a new session**, then a new submission; it does not recover
an old seat. Do not change cookie security or install phone trust automatically.

The owner confirmed entry Create/Join on PC/phone; the new connected lobby still
needs that real-device review. Existing server console recipes below
remain useful for diagnostics and features not yet connected to product UI.

HTTP remains useful for UI/health checks, but it is **not** the intended test setup
for Secure-cookie authentication. Do not weaken cookies to make LAN HTTP work.

Before enabling HTTPS, separately approve creation/trust of a development CA (for
example using `mkcert`). The leaf certificate must cover `localhost`, loopback IP
and your PC's current Wi-Fi IP. Keep the CA and all private keys outside Git and
preferably outside the repository. Never send a CA/server private key to a phone.
No certificate generation, trust installation, firewall opening or tunnel has
been performed by T14.1.

Once suitable certificates are available, copy `apps/web/.env.example` to the
ignored `apps/web/.env.https.local` and set these **absolute local paths**:

```dotenv
RR_HTTPS_CERT=C:/your-private-cert-directory/localhost.pem
RR_HTTPS_KEY=C:/your-private-cert-directory/localhost-key.pem
```

Start the frontend with:

```powershell
pnpm --filter @robot-puzzle/web dev:https
```

This must fail if certificates are missing/unreadable. It never silently falls
back to HTTP. These are server-only `RR_*` settings, not client-exposed `VITE_*`
values. The browser uses HTTPS/WSS while the same-PC proxy uses loopback HTTP.

For explicitly requested Wi-Fi testing:

```powershell
pnpm --filter @robot-puzzle/web dev:https --host 0.0.0.0
```

Use `https://YOUR-PC-WIFI-IP:5173` on Android. Trust only the public development
CA certificate through Android settings (steps vary by device); verify that the
browser accepts the certificate without a security warning. Do not use that phone
setup for untrusted networks. Ask before changing firewall rules. If the PC IP
changes, update the leaf certificate and configured Origin together.

Copy `apps/server/.dev.vars.example` to ignored `.dev.vars` in that same folder
and list exact permitted HTTPS origins, including scheme and port. No wildcards.
Restart the Worker after changes. T14.2 enforces `ALLOWED_ORIGINS` on session POSTs;
missing/untrusted/non-HTTPS Origins are rejected. It does not trust browser-supplied
forwarding headers to establish HTTPS or identity.

After approved HTTPS setup, open `https://localhost:5173` (not the HTTP URL) and
use its developer console to establish/reuse a session:

```js
const response = await fetch('/api/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    version: 1,
    commandId: crypto.randomUUID(),
    command: { type: 'session.open' },
  }),
});
console.log(response.status, await response.json());
```

Expect `session.ready` with the command ID and server time only. The browser
handles Set-Cookie automatically; JavaScript cannot read the HttpOnly credential.
Do not copy/log its value. On a repeated request, no new Set-Cookie should appear;
the original 24-hour deadline is unchanged. A second browser profile has a distinct
identity. Session bootstrap alone creates no nickname, room or seat. Serialize first-time opens:
a request UUID without the cookie is not proof of an existing identity. Browser
cookie acceptance and Android behavior are still unverified until this setup is
actually performed; automated header tests are not a substitute.

### Create a lobby after session bootstrap

In the same HTTPS browser console, keep one request object for a logical creation:

```js
const createRequest = {
  version: 1,
  commandId: crypto.randomUUID(),
  command: { type: 'room.create', nickname: 'Maria' },
};
async function createLobby() {
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createRequest),
  });
  console.log(response.status, await response.json());
}
await createLobby();
```

Expect `room.entered`, membership `created`, a room UUID/code, your seat ID and a
public lobby snapshot. No credential/private session ID is returned. The browser
sends the existing HttpOnly cookie automatically. The host initially appears
disconnected because live sockets are a later task, not because creation failed.

For a lost reply, call `createLobby()` again with the **same** object/command ID.
Do not change nickname under the same ID. To intentionally create another room,
use a new command ID. Limits are 5 attempts/minute (including retries), 20 rooms
per session and 1,000 retained room reservations locally; exhausted limits fail
without deleting old rooms or replay records. Pending work is recovered on retry
or a bounded server alarm. Restarting the Worker preserves rooms and reservations.
Join/share UI is not available yet, and ordinary HTTP is not proof of browser
cookie correctness. Do not copy cookies into URLs, logs or another browser.

### Join and explicitly resume

In a second browser profile/device, first establish its own session using the
session-bootstrap recipe above. In that same HTTPS console, enter the host's code:

```js
const joinRequest = {
  version: 1,
  commandId: crypto.randomUUID(),
  command: { type: 'room.join', roomCode: 'ABC234', nickname: 'Alex' },
};
const joinResponse = await fetch('/api/rooms/join', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(joinRequest),
});
const joinedRoom = await joinResponse.json();
console.log(joinResponse.status, joinedRoom);
```

Replace the example code with the actual created room code. Expect `room.entered`
with membership `joined`, your own seat and the updated public roster. Existing
members get their original seat/nickname (`resumed`) even if they submit another
nickname or the room is full. This does not change the host or cookie expiry.

To refresh the room snapshot from the same member's browser:

```js
const resumeRequest = {
  version: 1,
  commandId: crypto.randomUUID(),
  command: { type: 'session.resume', roomId: joinedRoom.roomId },
};
const resumeResponse = await fetch(`/api/rooms/${joinedRoom.roomId}/resume`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(resumeRequest),
});
console.log(resumeResponse.status, await resumeResponse.json());
```

Only run the resume recipe after a successful join/create. The host can likewise
resume using their creation reply's room ID. Resume never joins an outsider to a
room. To see changes automatically, open the live socket below.

For a lost response, retry the same request object/ID. Use a new ID for a new
logical action; reusing a join ID for resume in the same room is a conflict.
Retries return the original outcome with current state, not a stale cached roster.
Create/join/resume share 30 attempts/minute per session, including failed lookups
and retries; creation additionally has its 5/minute cap. Expired identities cannot
recover old seats by nickname. This console procedure has not yet been verified
on real HTTPS browsers/Android; the automated tests exercise server behavior only.

### Live lobby: two browser profiles, no new UI

After approved HTTPS setup, open two separate browser profiles/devices. Establish
their own sessions, create a lobby in the first and join it in the second. Two
ordinary tabs share one identity and are not two players. In each profile's same
HTTPS console, use the public room UUID from that profile's successful reply:

```js
if (location.protocol !== 'https:') throw new Error('Use the approved HTTPS setup');
const liveRoomId = 'replace-with-the-public-room-uuid';
let latestState;
const lobbySocket = new WebSocket(`wss://${location.host}/api/rooms/${liveRoomId}/socket`);
lobbySocket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.type === 'session.bound' || message.type === 'room.snapshot') {
    latestState = message.state;
  }
  console.log(message);
});
lobbySocket.addEventListener('close', ({ code }) => console.log('Lobby socket closed:', code));
```

The first message is your private `session.bound`; public `room.snapshot` messages
then show matching roster/board/revision across profiles. Cookies are supplied
automatically: no token parameter, subprotocol, handshake JSON or seat override.
New joins appear without another resume. The game SVG/UI is not wired to these
snapshots yet; compare console state, not the local simulator's board.

Once bound/open, request current state with:

```js
const readRequest = {
  version: 1, commandId: crypto.randomUUID(), roomId: liveRoomId,
  context: {}, command: { type: 'state.request' },
};
lobbySocket.send(JSON.stringify(readRequest));
```

In the host profile only, shuffle the server-owned board:

```js
if (!latestState || latestState.status !== 'lobby') throw new Error('Wait for the lobby binding');
const shuffleRequest = {
  version: 1, commandId: crypto.randomUUID(), roomId: liveRoomId,
  context: { lobbyId: latestState.lobbyId }, command: { type: 'board.shuffle' },
};
lobbySocket.send(JSON.stringify(shuffleRequest));
```

Both profiles should receive the same new catalog board/revision. Only the sender
receives `command.result`. Send the **same** `shuffleRequest` again to check
`duplicate: true` without another shuffle. Use a fresh ID for an intentional new
shuffle; changed payload under an old ID conflicts. Non-host/stale-context/wrong
room commands cannot change the board.

Close with `lobbySocket.close(1000)`. Other members see the seat become disconnected
only after its last valid socket closes; membership and host stay unchanged. At
most four tabs per session/room may connect. After a drop, explicitly resume and
open a new socket to rebind the same seat. Automatic reconnect/backoff is T17 work.
An expired/revoked session closes with 1008. Resource/backpressure or unimplemented
gameplay closes with 1013. Start creates one durable Preparing match/job and a
subsequent alarm verifies/reveals a Thinking target. T15.4 accepts `bid.submit`
with current `{ matchId, roundNumber }`, persists the first-bid deadline and enters
one initial Demonstrating attempt at expiry, including without connected sockets.
A full playable networked match still needs T16. Deferred/error preparation supports the
strict host-only `preparation.retry` command after five seconds; unavailable does
not. T15.3 exposes this Retry in the connected Preparing UI for the host when
eligible and automatically displays Thinking on the authoritative snapshot.

Application inputs are capped at 4 KiB and outgoing JSON at 64 KiB. Socket input
budgets are 120/minute per session/room across tabs, not per tab. Validity is checked
again for every operation/delivery; Registry failure closes rather than authorizes.
Development/runtime warnings may include Windows `EBUSY` cleanup and canceled
I/O-context diagnostics when socket contexts close. These are recorded separately
from assertions; investigate new unhandled errors rather than treating warnings
as a substitute for passing tests. Real browser/Android verification is pending.

After testing, stop LAN serving. Remove the installed development CA from the
phone's user credentials/trusted certificates settings when no longer needed.
Removal of PC CA trust is also a separate explicit operation, not an automatic
project cleanup. An untrusted browser warning is not successful HTTPS verification.

## Persistence, reset and tests

Development storage is under `apps/server/.wrangler/state`. Restarting Wrangler
preserves it. Registry and individual Room objects each have private SQLite
storage. Don't rename classes or change their migration history casually once
real rooms exist. Schema version 1 is initialized before requests; unsupported
versions fail without overwriting saved data.

`.wrangler/`, `.dev.vars*` (except the example), `.certs/`, and generated Worker
types are ignored. Dependency installation permits the required `workerd` binary
setup; unused transitive `sharp` build scripts are explicitly disabled.

Tests use isolated object storage and a freshly allocated temporary persistence
directory, never the developer's `.wrangler/state`. The restart test shuts down
and recreates Miniflare, checks both objects' saved data and verifies that a
different directory starts empty. Test-only marker handlers are bundled only
from `test/persistence.worker.ts`, never the production entry/config.

```powershell
pnpm --filter @robot-puzzle/server test
pnpm --filter @robot-puzzle/server typecheck
pnpm --filter @robot-puzzle/web typecheck
```

Type checking first runs `wrangler types` from the local config. Regenerate after
binding/runtime changes. `test:watch` watches Worker tests; the full `test` script
also runs the Node-hosted runtime-restart test.

To reset **only** local development data, first stop the Worker. Resolve and
inspect the exact `apps/server/.wrangler/state` directory within this repository,
then explicitly approve moving that directory to a backup outside `.wrangler`.
Restarting creates fresh storage. Restore that backup only while stopped. This
also invalidates local sessions/rooms once implemented. Never reset the repository,
delete the whole `.wrangler` parent, or reset data automatically on startup.

## Separate local target-preparation benchmark

```powershell
pnpm --filter @robot-puzzle/server benchmark:round-setup
```

This opt-in command runs a test-only Worker/Durable Object through Miniflare and
regenerates `docs/benchmarks/T15-local-workers-results.json`. It does not use or
alter live rooms, the production entry or persisted development storage. It is
separate from ordinary server tests and needs no Cloudflare account/deployment.
See [T15.1 measurements](benchmarks/T15-local-workers-preparation.md) for the
method, bounds and local-versus-hosted limitations. It exposes internal fixture
proofs only in local test evidence, never through the game server.

## Automated connected full-match verification

```powershell
pnpm --filter @robot-puzzle/server exec vitest run test/fullMatch.test.ts
```

Runs three complete ten-round matches through real session/create/join HTTP and
authenticated WebSockets in the local Workers test runtime: two-player winner,
six-player tie and two-player no winner, followed by same-room lobby return and
an explicit fresh Start. Controlled server time and catalog/target selection keep
the fixture reproducible; normal preparation budgets and server rules still run.
No live development rooms, certificates or production endpoints are modified.
This is network lifecycle verification, not browser rendering or phone testing.
Controller reconstruction/rebind is covered here; full process restart persistence
is separately covered by `preparationRestart.test.ts`. See the T16.6 task for the
remaining owner/device gate and preparation/resource limitations.

## Toolchain compatibility and limitations

T17.2 uses protocol v2: restart/update both development frontend and backend and
reload old browser pages together. Old v1 console request examples from historical
tasks must use the current exported protocol version for new actions. Persisted
rooms/matches/replay records are not wiped or upgraded by editing historical JSON.
Bound pages send ten-second keepalives; the server retires an unresponsive lease
after 30 seconds and preserves the seat/game. T17.3 now automatically reconnects
after transient loss/resume and restores the same seat after page refresh using
tab-scoped sessionStorage routing and the existing cookie (never a new identity).
Keep manual Reconnect as fallback. An uncertain move/bid remains blocked until
explicit Retry pending request reconciles its original command ID; offline inputs
are not queued. If tab storage is blocked, in-memory recovery works but refresh
recovery cannot be guaranteed; the UI reports this limitation. Different invite
links take precedence over restoring another room. Heartbeats share the existing
120 messages/minute/session budget and never create command replay rows. Run the
targeted network checks with:

```powershell
pnpm --filter @robot-puzzle/server exec vitest run test/presence.test.ts
```

For actual frontend-adapter HTTP/WebSocket recovery in a full local Worker runtime:

```powershell
pnpm --filter @robot-puzzle/server exec vitest run --config vitest.persistence.config.ts test/clientRecovery.test.ts
```

This test uses its own verified temporary storage and test-only controlled clock,
not live development rooms or debug production endpoints. It is not browser-rendered
or physical-device verification. Guest Leave, host End, grace skip and room expiry
remain later T17 steps.

The persistence suite separately covers full runtime recreation. Local test
success does not certify hosted heartbeat storage/hibernation costs or phone
background behavior; no certificate/firewall/deployment change is needed here.

The owner's installed Node is 20.19.4 and workspace Vitest is 3.2.x. Server tooling
is pinned to Wrangler 4.45.0, Workers Vitest pool 0.10.0 and Miniflare
4.20251011.1, with runtime compatibility date `2025-10-11`. Current Wrangler needs
Node 22; the replacement Vitest plugin requires Vitest 4.1+. Upgrading the host
runtime/tooling is separate from this small task. Before public deployment,
update/review the toolchain; these local pins are not a production-security audit.

These versions use SQLite `new_sqlite_classes` migrations, not the newer
declarative `exports` configuration. Do not mix the two formats. The Workers
adapter is deprecated upstream but compatible with our current workspace.

On this Windows environment the adapter may print an `EBUSY` temporary-directory
cleanup warning after successful tests. It does not mean assertions failed, but
some adapter-created temporary files may remain locked. Do not broadly delete
temporary folders to suppress it. The dedicated persistence test manages only
its own verified temporary directory.

Official references: [local runtime](https://developers.cloudflare.com/workers/local-development/),
[storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/),
[generated types](https://developers.cloudflare.com/workers/languages/typescript/),
and [current test-tool migration](https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-to-vitest-plugin/).

### T17.7 short local empty-room test

The normal empty-room lifetime is 30 minutes. To test without waiting, add this
single setting to the existing `apps/server/.dev.vars` (do not replace its
`ALLOWED_ORIGINS` or other values):

```dotenv
LOCAL_EMPTY_ROOM_TIMEOUT_SECONDS="60"
```

Restart the backend and create a fresh room. The override is accepted only with
`APP_ENV=local`; non-local environments always use 30 minutes. Close every room
tab on every device, then wait for expiry before reopening the code or refreshing.
A lost network may take up to the normal 30-second lease to be recognized first.
An authenticated socket return before expiry cancels the countdown; HTTP lookups
alone do not. Multiple tabs count as connected while any is responsive.

Remove the setting and restart afterward. Use fresh rooms for each timeout:
existing empty periods retain their stored deadlines across configuration changes
and restarts. This test does not change certificates, production configuration,
the separate 24-hour identity lifetime or any match rules.
