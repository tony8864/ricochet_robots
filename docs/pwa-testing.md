# PWA installation and testing

## Installable shell (T19.1)

The production frontend now links `/manifest.webmanifest`, standard 192/512 px
PNG icons, a separate opaque maskable 512 px icon, a 180 px Apple touch icon and
the original SVG source/fav icon. The manifest uses a stable root app ID, root
scope/start URL, standalone display and the existing dark background. Normal
browser play and `/room/:code` invitations keep their existing behavior.

T19.1 added no service worker, offline shell or custom installation prompt.
Live multiplayer always requires internet. Installation does not create a room,
renew the 24-hour identity or guarantee shared credentials/sessionStorage between
a browser tab and its installed application. Do not clear storage to troubleshoot
while an uncertain command or live room needs recovery.

## Assets and automated checks

Icon source: `apps/web/public/icons/robot-puzzle.svg`. The original four labeled
robot tokens use the game colors and fit inside the maskable central safe circle.
PNG exports are source assets; ordinary builds do not launch a browser.

To regenerate after editing the SVG, use the existing managed Playwright Chromium:

```powershell
pnpm --filter @robot-puzzle/e2e icons:generate
```

No new dependency is needed. If the managed browser is missing, its existing
one-time `pnpm test:e2e:install` download needs the usual approval/network access.
The generator writes only the four named app-icon PNGs. Review them visually
after changes, including a circular launcher crop and light/dark surroundings.

```powershell
pnpm build
pnpm typecheck
pnpm --filter @robot-puzzle/web test
pnpm --filter @robot-puzzle/e2e test:e2e tests/pwa-shell.spec.ts tests/entry.smoke.spec.ts tests/lobby.spec.ts
git diff --check
```

The browser harness builds production assets and serves them with the actual
Worker on isolated HTTPS. Checks cover manifest parsing/metadata, MIME types,
PNG decoding/dimensions/opacity/mask safety, unchanged entry, and actual invitation
join. Its disposable TLS exceptions are not proof of trusted-device installation.
See [browser testing](browser-testing.md) for harness boundaries and cleanup.

## Physical installation check

Use an already approved, trusted HTTPS origin. Do not install a new CA, relax
browser security or deploy merely to complete this checklist. Prefer a production
build served through the established same-origin frontend/API arrangement; Vite
development success alone is not production verification. Hosting is T21.

- Android Chrome: open the game, use the browser menu's Install/Add to Home screen
  action when available, then launch from the new icon. Check icon, name and the
  absence of the ordinary browser toolbar. Menu wording/offer varies by browser.
- iPhone Safari: Share → Add to Home Screen; enable Open as Web App where offered,
  then launch the new icon. Check safe-area layout and normal entry/invite play.
- Do not promise automatic install banners or complete removal of OS status and
  gesture bars. Standalone display is requested, not forced fullscreen.
- Record actual device/OS/browser/version, origin trust and browser-tab versus
  installed mode. If the installed context uses a different identity, record it;
  do not transfer credentials or assume that a started match admits a new seat.
- At the T19.1 checkpoint, offline launch could show the browser's own offline page.
  Static caching/update behavior is T19.2; assembled lock/resume and physical-device
  verification are T19.3–T19.4. A desktop Chromium manifest pass is not an Android
  launcher or physical iPhone pass.

The owner subsequently confirmed Android installation and gameplay from the
home-screen app worked. Exact version information was not supplied; this is not
an iPhone or offline/update verification result.

## Static caching and updates (T19.2)

Production builds generate `/robot-puzzle-sw.js` with a content-addressed cache
name and exact SHA-256 list of the HTML shell, emitted app JS/CSS/assets, manifest
and six reviewed icon/manifest paths. Maps, the service worker itself, API replies,
credentials and room state are not part of the cache. No new dependency is used.
Normal development does not register a service worker.

Installation fetches public files without cookies, checks status, MIME, privacy
headers and exact bytes, then writes the complete cache. Download/write failure
prevents activation; the existing version is retained. Root HTML is fetched from
its canonical `/` URL rather than following the asset host's `/index.html` redirect.

Eligible navigations (`/`, `/index.html`, `/room/:code`) try the network first.
Only HTML matching the active build is used. Offline, failed, or different-build
responses fall back to that worker's cached shell, preserving the address/invite.
This deliberate version pin avoids old-worker/new-HTML chunk mismatches. Real
4xx navigation responses remain errors. Unknown files and API routes never use
the HTML fallback. Only exact listed static URLs without query strings are served
from the install cache; there are no runtime cache writes or offline action queues.

New versions wait for old controlled tabs/windows to close. There is no forced
activation, initial client takeover or automatic reload. Reloading while another
old tab remains open still uses the old matching build. On normal activation,
cleanup removes only other `robot-puzzle-static-v1-` caches; unrelated caches and
all credential/route/pending-command storage are untouched. Close all old app
windows/tabs to adopt a waiting version, not just one of several tabs.

Caching is best effort: first-ever offline visits are unsupported; browser storage
eviction or denied registration/storage can remove offline availability. Online
play must remain usable if installation fails. A corrupted/evicted cached shell
gets a plain offline-recovery error rather than fabricated live state. Host-side
rewriting of built bytes would fail integrity checks; validate the real T21 asset
deployment and normal update/protocol compatibility before using it with friends.

Use different origins/ports for development and installed production previews.
An already active worker on the same origin can still control a development page;
development code never unregisters workers or deletes existing user caches.

Focused production check:

```powershell
pnpm --filter @robot-puzzle/e2e test:e2e tests/pwa-cache.spec.ts tests/pwa-shell.spec.ts
```

The update fixture alone stamps different build bundles, publishes isolated
temporary assets through Miniflare and omits one generated icon for the broken
deployment. It does not alter stored room/game state or expose production hooks.
Native install UX, storage eviction and physical Safari suspension remain device
checks, not consequences of a desktop browser pass.

### Production preview on the already approved local HTTPS setup

Keep the backend running. Stop only the development frontend, then run from the
repository root:

```powershell
pnpm build
pnpm --filter @robot-puzzle/web preview --mode https --host 0.0.0.0 --port 5173 --strictPort
```

The existing Vite 7 preview inherits the configured server HTTPS certificate and
API/WebSocket proxy; `--mode https` reads the existing ignored certificate paths.
Keep the same already approved exact Origin/port. Missing certificates should
fail rather than fall back to HTTP. This is local testing, not production hosting.
Do not change CA trust, firewall rules or backend Origin settings automatically.

Open online, allow caching to complete, and refresh once online. Disable both
Wi-Fi and mobile data, close/reopen and confirm the cached entry/recovery UI and
internet-required feedback; restore Wi-Fi and confirm normal Create/Join or
explicit retry. The owner confirmed this basic Android path after T19.2. Native
updates, current version details and physical iPhone behavior remain separate.

## Offline feedback and mobile presentation (T19.3)

Entry and connected presentation reuse the existing browser recovery environment
through a small React subscription. A known-offline browser disables Create,
Join, exact entry Retry and Reconnect; keyboard submit and click handlers also
check the current hint before sending. Drafts stay editable unless an uncertain
request already requires locked fields. Restore connectivity to re-enable the
appropriate action; uncertain entry requests still need explicit exact Retry.
There is no submit/replay triggered merely by an online event. That event is
only a hint: server binding/snapshots still establish an actual live connection.

The existing entry footer becomes an announced offline message, rather than a
second status banner. Existing transport/server error messages remain unchanged.
No new recovery controller, identity handling or game rules were introduced.

Viewport metadata now permits edge-to-edge layout without restricting zoom, and
the board page uses max(existing padding, safe-area inset) on every edge. Its
normal 5px horizontal padding and existing compact-landscape padding/breakpoints
remain when insets are zero. Body/root use dynamic viewport minimum height with
the existing `vh` fallback, avoiding a large-viewport minimum beneath a shorter
entry page. Existing entry/results/round-dialog safe-area rules were retained.

The mobile browser checks measure narrow/short phone, tablet and desktop geometry,
including a 390×320 shortened viewport with focus/scroll tests. This is not a
native software-keyboard, nonzero safe-inset or iPhone suspension test. Device
keyboard/notch/home-indicator review remains T19.4. Existing native modal scrolling
and minimum touch targets are checked without changing the board renderer.

References: [WebKit safe-area layout](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)
and [browser online-hint limitations](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine).
The online gate matches the existing T17 transport policy; it is not proof that
an internet connection/server is available or that a local network is unreachable.

Implementation references:
[service-worker lifecycle](https://web.dev/articles/service-worker-lifecycle),
[Vite 7 plugin API](https://v7.vite.dev/guide/api-plugin).

## Primary references reviewed for T19.1

- [Chrome installation criteria changes](https://developer.chrome.com/blog/update-install-criteria):
  browser-menu installation no longer requires a service-worker fetch handler;
  automatic promotion is a separate browser decision.
- [Web app manifest](https://web.dev/learn/pwa/web-app-manifest) and
  [maskable icon guidance](https://web.dev/articles/maskable-icon).
- [Apple web-app configuration](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)
  (archived metadata/icon guidance) and
  [current iPhone installation instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/27/ios/27).

Recheck current platform requirements when changing implementation. These links
do not substitute for actual device acceptance evidence.

## Visible app version (T19.4)

The UI footer displays the web package's version (currently `v0.1.0`) at the
bottom of every app screen, centered and inside the safe-area inset. The value is
injected from `apps/web/package.json`, making that package version the single
source of truth. Increment it for a distinguishable release/update; an already
open client keeps its old label until a waiting service worker activates after
all old controlled clients close.
