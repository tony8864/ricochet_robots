# T19.2 — Static Caching and Safe Updates

Status: implemented and automated checks passed on 2026-11-04. Basic Android
offline launch/recovery was subsequently owner-confirmed. Broader physical and
update checks remain T19.4; this is not an iPhone or hosted-deployment certification.
Parent: [T19](T19-pwa-and-mobile-lifecycle.md).

## Scope

- Inspect Vite's built asset graph, server asset routing and the existing HTTPS
  browser harness. Choose a small build-integrated service worker strategy;
  explicitly document which public files it owns before implementing it.
- Cache only the versioned public shell and required same-origin static assets.
  Use an explicit allowlist/build asset list, not a blanket cache-first handler.
  Bypass `/api` and all non-GET/cross-origin traffic; never persist authenticated
  responses or room data. WebSocket traffic remains entirely outside caching.
- For eligible application navigations, prefer the network and fall back to a
  complete cached shell when unavailable. Do not turn API errors or arbitrary
  missing static resources into successful HTML responses. Preserve invite URLs
  through fallback so online re-entry can use the intended room code.
- Make installation atomic: a failed new cache must not replace the working
  version. Keep cache naming/cleanup confined to this app's owned namespace and
  protect assets needed by still-open clients. Plan against stale HTML/chunk
  mismatches before deleting any older build assets.
- Register only for the production build by default. Development/HMR and unrelated
  origin service workers/caches must not be altered.
- Do not force `skipWaiting`, client takeover or automatic page reload during
  live play. Default to a waiting update that takes effect after old clients
  close. Do not add an in-match update button in this checkpoint. Verify the
  resulting lifecycle, multi-tab behavior and storage/retry preservation.

## Likely files

Frontend service worker/registration and Vite build integration, focused web tests,
`apps/e2e` production-build cases, and PWA testing notes. Review dependencies before
installation; no Worker/Durable Object behavior or protocol changes are planned.

## Acceptance and checks

Test cached launch and offline reload after a successful online visit, including
an invite route. A first-ever offline visit is not guaranteed to load. Prove API
requests bypass caches, failed requests/credentials never enter app caches, and
offline gameplay is not accepted or queued.

Exercise two distinct builds: incomplete update failure, waiting update with an
open client, and adoption after old clients close. Check that current gameplay
does not reload, reconnect retains original pending request IDs, and an upgraded
client obtains current server state. Do not fabricate protocol compatibility;
existing validation/terminal feedback still applies.

Use isolated test-owned contexts/storage, not the owner's active rooms/profile.
Run relevant unit/browser tests, type checks, production build and whitespace
checks. Record cache/update policy and unresolved rollout limitations. Stop before
T19.3, broader operational review or deployment.

## Implemented policy

`apps/web/build/staticPwa.ts` emits a standalone service worker from typed source
in `apps/web/pwa/worker.ts`, with a separate worker-lib type check. It uses existing
Vite tooling, no added dependency, and a content-addressed cache name. The exact
allowlist comprises emitted app assets/HTML (not source maps), the manifest and
five icon files. Each download omits credentials and validates status, MIME,
privacy headers and SHA-256 bytes. All downloads finish before cache writes;
write failure deletes only that incomplete version and fails installation.

The initial browser test exposed the real asset host's `/index.html` redirect.
The worker now downloads canonical `/` without following redirects, storing it
under an internal shell key. Navigation tries network first on root/invite routes,
accepting only HTML for the active build; offline/error/different-build responses
use the cached matching shell. Genuine 4xx navigation responses remain errors.
This version pin is intentional: an old controlling worker must not serve new
HTML referencing uncached/deleted chunks. Unknown assets never receive the shell.

Registration is production-only, best effort and does not overwrite another root
worker. Default waiting/activation protects old clients; there is no skipWaiting,
clients.claim, reload handler, install banner or update button. Activation cleans
only this app's older static-cache namespace. API/non-GET/cross-origin traffic
bypasses it entirely. No runtime cache writes, room state, secrets, command queue,
Background Sync, gameplay or backend lifecycle changes were introduced.

## Verification actually run

- `pnpm --filter @robot-puzzle/web test`: 422/422 passed in 38 files, including
  five new registration tests (secure/unsupported contexts, load timing, owned
  registrations and graceful failure).
- `pnpm test:e2e`: all 13 browser cases passed in 4.1 minutes with service workers
  enabled: actual ten-round play/rematch, six seats, bidding/demonstration,
  lost-reply exact retry after refresh, recovery/lifecycle, manifest and new
  caching/update coverage. Existing controlled-clock cases remain test-only.
- After strengthening the update case, the focused
  `pnpm --filter @robot-puzzle/e2e test:e2e tests/pwa-cache.spec.ts` passed again.
  It proves cached offline reload/invite entry, real API bypass/failure, no live
  board shown offline, failed update rejection, two-tab version pinning, no forced
  reload, adoption after old tabs close, old-cache cleanup with unrelated cache
  preservation, cookie-free static downloads, and fresh same-seat/board state
  after the upgraded client explicitly rejoins.
- `pnpm typecheck`: workspace checks passed, including isolated worker types.
- `pnpm build`: passed; production emits `robot-puzzle-sw.js` (about 4.5 kB).
- `git diff --check`: passed; Git emits LF/CRLF normalization notices.

The initial failed runs and a corrected offline-text locator were not counted as
passes. Full-suite warnings included the previously known Miniflare SQLite alarm
cancellation and Node color-environment warning, with final exit zero. The full
workspace unit suite was not rerun; frontend tests and the full browser regression
were run instead for this frontend-only change.

The isolated update fixture alone stamps different frontend bundles and publishes
temporary assets, removing one generated icon to create an incomplete deployment.
It has no production debug endpoint, fake accepted state or changed server clock.
No user rooms, certificates, trust, credentials, configuration or unrelated files
were deleted/changed. No commit or deployment. Build/protocol compatibility,
storage eviction and physical iPhone/offline/update behavior need later checks;
see [PWA testing](../pwa-testing.md). T19.3 has not started.

Subsequent owner Android check: using the production-preview instructions, the
owner confirmed closing/reopening the installed app with connectivity off still
showed entry, Create reported a connection error, and restoring Wi-Fi allowed room
creation. This confirms the basic owner-reported offline launch/recovery path,
not manual version updates, exact browser versions, or physical Safari. T19.3
subsequently improves the known-offline buttons instead of allowing that failed
Create request; those newer controls need their own device review.
