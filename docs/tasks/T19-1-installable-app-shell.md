# T19.1 — Installable Application Shell

Status: implemented; automated checks passed on 2026-11-04. The owner subsequently
confirmed Android installation, home-screen launch and actual gameplay worked.
Exact browser/version and physical iPhone verification remain unrecorded/unverified.
Parent: [T19](T19-pwa-and-mobile-lifecycle.md).

## Scope

- Inspect the actual frontend entry, build/public assets, invite routing and
  existing deployment assumptions. Verify current manifest/icon requirements
  using primary browser documentation; do not rely only on a development server.
- Add a web app manifest with stable app identity, Robot Puzzle names, entry
  start URL, suitable scope, standalone display, and existing dark theme colors.
  Default launch enters the existing entry/resume flow, not a hardcoded room.
- Supply original local icons, including appropriate ordinary and maskable
  variants and an Apple touch icon. Reuse the robot motif; keep artwork simple,
  centered and legible when cropped. Prefer existing vector/code-native assets
  and an available build tool over a new asset dependency.
- Link the manifest/icons and appropriate theme metadata from `apps/web/index.html`.
  Introduce viewport/safe-area metadata only with regression checks; detailed
  layout review belongs to T19.3. Do not suppress user zoom.
- Keep direct invitations and normal link play unchanged. Do not add install
  popups, custom install banners, a service worker or caching in this checkpoint.

## Likely files

`apps/web/index.html`, new manifest/icons under `apps/web/public`, focused asset
or build checks, and local PWA verification instructions. Settle exact filenames
after inspection; do not change server/game packages unless a separately approved
blocking issue requires it.

## Acceptance and checks

Validate manifest fields, icon dimensions/purpose, actual asset responses/MIME
types and production output paths. Check entry and direct invite navigation in
the built application; run relevant frontend tests, workspace type checks,
production build and whitespace checks. Review icon appearance on dark/light
surroundings and cropped masks.

Where trusted HTTPS/device access exists, check offered installation and launch
from the new icon. Record unsupported/unavailable checks, not assumed passes.
Offline launch is not promised yet. Stop before T19.2; do not commit or deploy.

## Implemented checkpoint and evidence

Added the root-scoped standalone manifest, theme/Apple metadata, SVG favicon and
four original PNG exports. Root launch uses the unchanged entry/resume flow;
invitations retain their route. No orientation lock, zoom restriction, viewport
change, service worker, cache, install banner, dependency or game/server change.

`apps/e2e/generateAppIcons.ts` rasterizes the editable SVG using existing managed
Chromium through `pnpm --filter @robot-puzzle/e2e icons:generate`. Exports are
checked in; ordinary builds do not need this command. Standard and maskable
512 px exports were visually inspected. Automated pixel checks verify the
maskable image is opaque and all non-background artwork lies in its safe circle.

Checks actually run:

- Icon generation: passed, four PNGs produced.
- `pnpm --filter @robot-puzzle/e2e test:e2e tests/pwa-shell.spec.ts tests/entry.smoke.spec.ts tests/lobby.spec.ts`:
  6/6 passed in the isolated production HTTPS harness, including the new manifest,
  MIME, PNG, mask-safety and Chromium parser checks plus real entry/invite joining.
- `pnpm --filter @robot-puzzle/web test`: 417/417 passed (37 files).
- `pnpm typecheck`: all workspace checks passed, including generator/browser tests.
- `pnpm build`: production build passed (Vite 7.3.7).
- `git diff --check`: passed; Git reports existing LF/CRLF normalization notices.

No full multiplayer E2E suite or full workspace unit suite was rerun in this
metadata/assets-only checkpoint. No system trust/device configuration, live room,
deployment or commit was changed. Browser TLS exceptions are confined to the
existing disposable harness. Actual Android install/launch and physical iPhone
checks remain pending; follow [PWA testing](../pwa-testing.md), which also records
primary browser references and current checkpoint limitations. T19.2 is not started.
