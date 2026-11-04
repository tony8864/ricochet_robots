# T18.1 — Browser Test Harness

Status: implemented; final regression evidence recorded below.
Parent: [T18](T18-end-to-end-multiplayer-tests.md).

## Scope

- Inspect existing runtime, Vite proxy, HTTPS/cookie behavior and tests. Propose
  a compatible browser E2E runner/version, location, scripts and minimal dependency
  addition before installing it. Keep ordinary unit tests independent of browser
  downloads and E2E startup.
- Run the real connected frontend and Worker in a fresh test-owned local
  environment. Define isolated persistence, owned ports, startup/readiness,
  shutdown and cleanup. Never wipe or borrow `.wrangler/state` or stop unrelated
  processes. Validate HTTPS/Secure-cookie/WSS behavior in the actual browser;
  do not weaken Origin/cookie checks or install device/system CAs.
- Review deterministic time and board-selection needs for later tests. Prefer
  a separate test-only entry/fixture, excluded from normal Worker routing/build,
  if server clock control is needed. Prove normal builds cannot expose it before
  using it. Do not quietly add environment-sensitive gameplay behavior.
- Provide isolated player contexts, accessible locators, condition waits and
  bounded failure artifacts. Document private-data risks of traces; ignore output.
- Add one smoke test that loads the real entry page and confirms its controls.

## Acceptance and checks

One documented command launches the isolated app, runs the rendered entry smoke
test and shuts down owned resources; a second run starts cleanly. Verify cookie
and proxy assumptions, context isolation and fixture exclusion. Run relevant
tests/type checks/build/whitespace checks and record any download/runtime blockers.
Files likely include runner config/tests, test fixtures, workspace scripts and
local-testing documentation; settle exact paths after inspecting conventions.
Stop before T18.2 or changing gameplay UI.

## Implemented checkpoint

Added `apps/e2e` with reviewed/pinned Playwright 1.64.1, reusing existing Vite,
esbuild and Miniflare versions. Two smoke cases run a production frontend build
and the actual Worker over isolated loopback HTTPS. Temporary assets/storage and
OS-selected ports belong only to this harness. Independent contexts verify entry
rendering, nickname persistence/isolation and real Secure/HttpOnly cookies; a
Chromium handshake check verifies actual WSS 404 rather than accepting a TLS error.

Root commands are `pnpm test:e2e:install` (one-time managed browser download) and
`pnpm test:e2e`. Ordinary `pnpm test` remains browser-independent. Workspace type
checking includes the new harness. Failure screenshots/context are ignored;
traces/videos and credential dumps are not enabled. No CA/system trust, development
rooms, `.dev.vars`, running servers, gameplay/UI or normal routing was changed.

The built assets are served by Miniflare's same-origin asset router, not Vite's
development proxy; the limitation is explicit in [browser testing](../browser-testing.md).
Only the disposable Chromium process ignores test-certificate errors. Native TLS
trust, authenticated lobby WSS and physical devices remain unverified here.

No deterministic clock/selection hook is introduced. Production time suffices for
entry smoke; the excluded fixture decision is deferred to round testing. Worker
bundle graph inspection rejects test/E2E inputs. This keeps normal builds free of
debug routes instead of changing production guards for tests.

Two final consecutive `pnpm test:e2e` runs passed (2/2 each) with fresh build,
port/storage and completed teardown. Initial failures were harness-only: ambiguous
locator, an unsuitable API-request diagnostic and WSS certificate handling. All
were corrected without weakening application authentication or changing its UI.
Verified runner environment: Node 20.19.4, Chromium 156.0.8078.4, Windows.

Final verification: all 1,530 existing workspace tests passed, separately from
the two browser smoke tests. Workspace type checks (including E2E), ordinary web
production build and whitespace checks passed. Existing Worker shutdown/Windows
temporary-cleanup warnings remain; final commands exited zero. No commit or
deployment. T18.2 remains pending.
