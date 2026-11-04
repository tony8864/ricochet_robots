# T19.4 — PWA and Device Verification

Status: complete with documented coverage limits, owner-accepted on 2026-11-04.
Automated and owner-reported Android/PC checks passed, including physical update
adoption. The owner approved deferring physical iPhone Safari/home-screen checks
to T21's trusted HTTPS deployment. Exact browser versions were not recorded.
Parent: [T19](T19-pwa-and-mobile-lifecycle.md).

## Automated verification

- Run the production-build PWA checks: manifest/assets, standalone configuration,
  service worker registration/scope, static-only caching, offline navigation,
  API exclusion and two-build update lifecycle.
- Run the existing multiplayer browser suite with service worker behavior visible,
  not globally blocked merely to preserve old assertions. Use isolated contexts
  and clarify which cases actually exercise an installed/controlled shell.
- Run workspace unit tests, type checks, production build and whitespace checks.
  Record exact commands/counts, warnings and reproducible failures.
- Check normal entry and direct invitations still work without installation.
  Automation/emulation is not proof of native install UI, actual safe areas,
  physical lock/resume or iPhone Safari behavior.

### Results (2026-11-04)

- `pnpm test`: passed, 1,543 workspace tests. This included 430 web tests and
  280 server tests (250 regular and 30 persistence/recovery).
- `pnpm typecheck`: passed across all workspace projects.
- `pnpm build`: passed, including the production static service worker.
- `pnpm test:e2e`: passed, all 15 isolated production HTTPS browser cases in
  4.2 minutes. This includes the PWA cache/update lifecycle, invite join,
  responsive geometry, full-match play and recovery.
- `git diff --check`: passed. Git printed LF-to-CRLF notices for existing
  Windows-worktree files; no whitespace errors were reported.
- Worker tests printed known Miniflare alarm-cancellation and Windows `EBUSY`
  temporary-directory cleanup warnings. E2E also printed the existing
  `NO_COLOR`/`FORCE_COLOR` warning. They did not fail the checks.

The commands were invoked through the installed pnpm executable because `pnpm`
is not on this PowerShell session's PATH. The full workspace run preceded the
version-footer change. After adding the permanent bottom-centered `v0.1.0` footer
(sourced from `apps/web/package.json`), follow-up verification passed: 431 frontend
tests, web type check, production build, all 15 browser E2E cases and another
`git diff --check`. No game logic or backend code changed. The physical
old-client/waiting-update/relaunch check subsequently passed by owner report:
the open Android app stayed on its old screen without a version label; after
loading the same origin in regular Chrome and closing the app and phone game
tabs, launching from the home-screen icon displayed `v0.1.0`. The frontend was
running HTTPS production preview. This is observable update-adoption evidence,
not a direct inspection of the phone worker's internal waiting state.

## Guided physical-device checklist

Use the existing approved HTTPS setup where possible. Do not change phone CA
trust, security settings or hosting without separate permission. If installation
is blocked by local-origin trust or browser restrictions, report it and keep
production-hosted verification for T21 rather than bypassing security.

Record device, OS, browser/version, browser-tab versus installed mode, origin
and results. Guide the owner one step at a time when they perform the tests.

1. On Android Chrome, open the normal link, install if offered, close the browser
   tab and launch from the home-screen icon. Check name/icon and standalone UI.
2. Create/join with an independent PC identity. Check room code, roster, board,
   Start, bids and one demonstration with Undo/Reset. Do not assume installing
   copied an existing browser identity; inspect actual seat behavior.
3. Lock/unlock or switch apps during bidding and demonstration. Confirm current
   server phase/deadline/positions/history return, without a duplicate seat or
   automatic fresh-ID retry of an uncertain action.
4. Turn connectivity off after assets are cached; reload/relaunch. Check clear
   online-only feedback and unavailable live actions. Restore connectivity and
   confirm authoritative recovery; no offline moves/bids are submitted later.
5. Check direct invite links, keyboard opening, short-screen scrolling, menus,
   dialogs, results and safe-area spacing. The board remains square and controls
   accessible in both normal browser and standalone modes.
6. Check a second local build with the app open, then close old clients and
   relaunch. Confirm no surprise in-match reload and eventual new-version launch.
7. Repeat installation, link entry, safe areas, lock/resume and offline recovery
   on a physical iPhone in Safari and from its home-screen icon when available.

## Handoff and completion

### Owner-reported device evidence (2026-11-04)

- Device: Galaxy A36 5G, Android 15; exact Chrome version was not recorded.
  Both installed-app and normal Chrome/Incognito contexts were exercised over
  the existing local HTTPS setup. The exact host alias used for each run was
  not recorded.
- Installed app launched from its home-screen icon without browser chrome and
  retained the nickname. The phone and a PC browser joined the same lobby,
  started a match, compared bids, and used Undo/Reset during a demonstration.
- Switching away during a demonstration and locking/backgrounding during
  bidding preserved the server-controlled state and countdown.
- Offline feedback appeared and live actions were disabled. After restoring
  connectivity, the phone returned to the match; the PC showed two online and
  the same round/bid state. No queued offline action was observed.
- The host menu did not shift the board; the square board, scrolling and
  visible controls fit the Android screen. Confirmation dialogs were reported
  as fitting. A direct link with a real code opened in Android Chrome, prefilled
  the room code, and joined the PC-created lobby with a distinct phone identity;
  both clients showed the same two-player lobby. The keyboard also opened on the
  normal-browser entry form.
- A two-player match was advanced through ten skipped rounds. Both clients
  showed Round 10 Complete; the guest waited for the host, and after View
  Results both reached the no-winner standings with zero points. The phone
  results screen fit and showed the expected host/guest actions.
- Rejoining after closing a browser tab was intermittently slow (reported at
  about two minutes), then worked in both `preview` and `dev:https` runs. The
  owner could not reproduce it consistently or attribute it to either command;
  this remains an intermittent observation, not a confirmed preview defect.

Not explicitly verified on a physical device in this pass: iPhone Safari/browser
plus home-screen behavior. Exact Chrome/PC browser versions and exact host alias
were not recorded. Automated tests do not substitute for those checks.

Document installation instructions for Android and iPhone, normal link fallback,
internet requirement, update behavior and any storage/identity-context differences.
Keep credentials and private command payloads out of evidence/artifacts.

Fix only small demonstrated T19 issues with tests; seek direction for broader
architecture/product changes. Record unavailable physical checks as unverified,
and obtain explicit owner acceptance before closing with those limits. T18's
accepted missing Safari coverage does not automatically waive T19 Safari checks.

Update T19 and plan status with actual evidence. No automatic commit, deployment,
T20 security certification or arbitrary-device compatibility claim.
