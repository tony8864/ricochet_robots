# Browser tests (T18.1–T18.5)

Final automated/device evidence and outstanding manual checks are tracked in
[T18.6](tasks/T18-6-device-verification-and-handoff.md). Automated contexts and
runtime-restart tests do not replace the two-real-device full-match review gate.

## Run

From the repository root, after the usual workspace dependency installation:

```powershell
pnpm test:e2e:install
pnpm test:e2e
```

The first command downloads Playwright-managed Chromium into the user's browser
cache; it is a one-time prerequisite for this pinned runner/browser revision.
The second command builds a temporary production frontend, starts an isolated
HTTPS Worker, runs the browser checks and tears down its runtime/storage. No manual
backend/frontend startup, phone connection or DevTools console is needed. Repeat
the second command to run against fresh storage again.

`pnpm test` continues to run only the existing Vitest suites. Browser tests have
their own command; `pnpm typecheck` includes their TypeScript. The harness lives
in `apps/e2e`, not application code. Playwright is pinned to 1.64.1, verified here
with Node 20.19.4 and bundled Chromium 156.0.8078.4 on Windows. Recheck compatibility
when upgrading; browser downloads and headless process launch need local access.

## Isolation and HTTPS

- Uses real `apps/server/src/index.ts`, Registry/Room classes, session routes and
  a production build of the existing React entry. No local simulator or mocks.
- Miniflare's asset router serves the temporary frontend build and dispatches
  `/api/*` to the real Worker. SPA routes serve the frontend. The Vite development
  proxy is deliberately not used: this is an isolated single-origin build harness,
  not a test of Vite's LAN proxy or a production hosting configuration.
- Listens only on loopback, with an OS-selected ephemeral port and exact matching
  allowed Origin. Assets and durable storage use a unique OS-temp directory.
  No Wrangler config or `.dev.vars` is loaded; Vite dotenv loading is disabled.
  Normal `.wrangler/state`, running development servers and port 5173/8787 are
  not borrowed, reset or stopped.
- Miniflare supplies its bundled test TLS certificate. Certificate exceptions
  apply only to disposable Playwright contexts/Chromium process (including WSS).
  This does not install a CA or test production certificate trust. Do not copy
  the launch exception into a normal user browser or deployment.
- Two independent contexts model separate identities, cookie jars and local
  storage. Separate contexts are not separate devices. Shared-context tabs will
  intentionally represent the same player in later cases.
- Teardown disposes the owned runtime and removes only the verified temp parent
  with the harness prefix. A crash may leave a `robot-puzzle-e2e-*` temp directory;
  do not broadly delete OS-temp folders to clean it up.

## What the two smoke tests prove

1. Real entry controls render over HTTPS, blank nicknames disable actions,
   nickname enables Create and survives reload in only that player's storage.
   The production build does not expose the development simulator link.
2. Real session bootstrap sets distinct Secure/HttpOnly/SameSite cookies for the
   two contexts; page script cannot read the credential. A debug-clock API is
   absent. An actual WSS request for an unknown room is rejected with HTTP 404,
   checked through Chromium's protocol events so TLS failure is not a false pass.

These smoke tests alone do not prove authenticated lobby or full-match behavior.

## T18.2 entry/lobby browser coverage

Three additional cases use the real rendered UI to exercise validation/inline
not-found errors, Create/manual Join, clipboard copying, normalized invite links,
Host/You roster indicators, shared rendered board geometry and host-only Shuffle/
Start. They verify one-player Start is disabled, a third independent identity
cannot join after Start, and both original identities refresh into the same
highlighted seats/match/roster. An observer retains public snapshots only to
compare public room/match/seat IDs; no private binding metadata is saved.

These five cases run with `pnpm test:e2e`. No state injection, test clocks or new
permissions are introduced into the app. Clipboard permission is runner-scoped.
The nickname boundary follows the existing shared contract rather than changing
the application limit. Successful authenticated WSS lobby delivery is now exercised;
full matches, physical phones, native TLS trust and T20 audit remain separate.

## T18.3 real round browser flow

The sixth case (`tests/round.spec.ts`) uses the real 60-second server bidding
window, so the complete command now takes roughly a minute plus startup/actions.
It covers read-only Thinking, canceled Skip, accepted bids/lowering/tie priority,
actual expiry, active/spectator permissions, move/no-op/Undo/Reset, Give Up rollback,
successful second bidder, one point and all-four carry-forward into a new verified
round after host Continue. Both rendered positions/counts and public state are
checked. At least two robots finish displaced; the test does not shorten rules.

The route driver is private Node-side code. It calculates a replay-checked route
for the actual server-selected target, within existing bounded solver policy,
then performs normal UI clicks. No route/proof is provided to the browser as data
or exposed via the Worker. Preparation/route limits fail the test, not trigger a
larger budget, state injection or fallback to an unverified target. No deterministic
clock/entropy fixture has been added. This is not ten-round browser proof.

## T18.4 ten-round game and six identities

`tests/full-match.spec.ts` adds a mixed-outcome ten-round browser game and a
focused six-context shared-state case. The full game uses two real bidding
windows: a successful round after an earlier failed attempt, then an exhausted
bidder round. The remaining eight rounds use the existing confirmed host Skip
Round. It checks verified distinct targets, all-four carry-forward/rollback,
unchanged board and identical scores/state after each round. It then checks
Finished, both refreshes, same-room lobby return and explicit fresh Start.

The six-context case checks distinct seats, board/roster equality, accepted bids,
lowering and original first-bid ordering. These are six independent browser
identities, not physical participants or phones. Tie/no-winner permutations remain
covered by existing tests rather than another expensive full browser match.

With these two cases, `pnpm test:e2e` runs eight cases and spends three real minutes
in bidding windows (one in T18.3, two in the complete match), plus setup/actions.
To run only the new checkpoint:

```powershell
pnpm --filter @robot-puzzle/e2e test:e2e tests/full-match.spec.ts
```

No test clock, server hook, new dependency or production rule is introduced.
The complete match is not a ten-successful-round claim; physical-device full-game
and broader recovery verification remain separate. Preparation/route limits must
be reported, never bypassed by injecting Finished or changing search budgets.

## T18.5 browser recovery and failures

Three `tests/recovery.spec.ts` cases add native offline/online and same-seat tabs,
inline entry failure/retry, tab-local Leave, a real lost-move acknowledgment across
refresh/exact retry, retained Undo history, server-owned grace/cancel/skip, modal
recovery, host End/code rejection and distinct empty expiry. The real full-match
case now also checks host and guest offline recovery from Finished before rematch.
The suite has eleven cases; normal-time cases still spend three actual minutes in
bidding windows. Recovery cases use the private server-clock fixture described
below, not shortened production rules or a browser-only clock.

```powershell
pnpm --filter @robot-puzzle/e2e test:e2e tests/recovery.spec.ts
```

The WebSocket helper connects to the real server and drops one armed move reply,
not the accepted move/snapshot. It checks the original command survives refresh,
the exact retry yields a duplicate receipt, and robot/count state changes once.
Its bounded retained data omits cookies, private bindings and proofs. Explicit
proxy closes plus browser offline state test definitive transport loss, not every
mobile half-open TCP or suspension behavior. The native offline case is separate.

### Private controlled server time

Only recovery cases opt into `controlledTime` on their isolated worker fixture.
The harness still verifies the production Worker graph excludes test files before
bundling a separate `apps/server/test/browserRecovery.worker.ts`. That test bundle
adds a validated, monotonic server clock controlled by Node through Miniflare's
private Durable Object namespace API; it does not add an HTTP debug route, change
the app, disable authentication or patch accepted game state. Browser requests to
debug-clock paths remain ordinary rejected API requests. Clock/tick methods are
unreachable through normal Worker routing and normal builds never import them.

Open sockets send real authenticated snapshot reads between bounded clock steps
to keep existing lease rules satisfied. Empty expiry advances with no such reads.
Real alarm normalization authorizes all deadlines and transitions. Browser clocks
and backoff remain real; UI resynchronizes through normal server metadata. Other
test files use a fresh normal-time runtime, and production-time bidding assertions
remain in the combined suite. No `.dev.vars`, certificates, migrations or running
development room is modified. This is not a production time-control facility.

Interception reference: [Playwright WebSocket routing](https://playwright.dev/docs/api/class-websocketroute).

To run only this round checkpoint:

```powershell
pnpm --filter @robot-puzzle/e2e test:e2e tests/round.spec.ts
```

Run the browser suite and ordinary workspace suite sequentially on this development
machine. An overlapping regression run hit the existing six-player server test's
60-second timeout; no timeout or game budget was increased. Do not treat repeated
reruns as a substitute for recording/diagnosing a timeout or assertion failure.

## Clock and fixture decision

T18.1–T18.3 use production time and production Worker routing; there is no test clock,
entropy override or debug endpoint. The harness checks the Worker input graph
excludes test/E2E fixtures, and browser requests to the absent API return 404.
T18.3 deliberately uses actual server deadlines and a private adaptive route
verifier; T18.4 can review a separate excluded entry if controlled server time or
deterministic target ordering is needed for a full match. Never patch client clocks expecting
server deadlines to change, shorten production rules or expose hidden proofs.

## Failures and private artifacts

Failures report the test, assertion and source line. Failure screenshots and
context descriptions go to ignored `apps/e2e/test-results`; retries are disabled
so a race is visible. Trace/video recording is off by default. Do not share raw
traces, request logs, cookie dumps or storage state: these can contain credentials
and personal nicknames. Tests compare credential properties/equality as booleans
and do not attach raw cookie/session values. Review screenshots/context before
sharing them. No production logging or identity-security behavior was weakened.

Initial smoke development corrected a locator that matched both a labeled region
and its textbox. A cookie-bearing API-request diagnostic was removed in favor of
browser fetches returning only safe metadata. WSS additionally needed the scoped
Chromium certificate exception; asserting a handshake error alone was insufficient.

Runner references: [browser installation](https://playwright.dev/docs/browsers),
[isolated contexts](https://playwright.dev/docs/browser-contexts), and
[test options](https://playwright.dev/docs/test-use-options).
