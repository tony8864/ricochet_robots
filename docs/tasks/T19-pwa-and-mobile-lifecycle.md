# T19 — PWA and Mobile Lifecycle

Status: complete with documented coverage limits, owner-accepted on 2026-11-04.
T19.1 installation/gameplay and T19.3 online/offline recovery
were owner-confirmed on Android. T19.2 caching/updates and T19.3 presentation are
implemented. T19.4 automated checks passed on 2026-11-04; Android/PC checks now
include a real direct-link join, physical final-results review and Android update
adoption to `v0.1.0`. The owner approved deferring physical iPhone Safari checks
to T21's trusted HTTPS deployment. Exact browser versions were not recorded. An
intermittent slow tab-close/rejoin was observed but not consistently reproduced.
Parent: Milestone 5 in [the plan](../plan.md).

## Goal

Keep the game playable from a normal browser link, and optionally installable
from that same website with a home-screen icon and an app-like standalone window.
Cache only the public application shell and approved static assets. Live play
still requires internet and authoritative server snapshots.

T17 already provides bounded reconnect, resume and exact command retry. Safe-area
CSS also exists. Review and reuse those foundations rather than implementing a
second recovery system or redesigning the board and controls.

Read `AGENTS.md`, product, architecture, plan and the selected subtask before
coding. Implement one separately requested checkpoint at a time. These documents
do not authorize implementation, dependency installation, certificate/trust
changes, commits, infrastructure changes or deployment.

## Ordered checkpoints

- [x] [T19.1 — Installable application shell](T19-1-installable-app-shell.md) (owner confirmed Android installation/gameplay)
- [x] [T19.2 — Static caching and safe updates](T19-2-static-caching-and-updates.md) (automated checks passed; device checks remain T19.4)
- [x] [T19.3 — Online-only feedback and mobile presentation](T19-3-online-feedback-and-mobile-presentation.md) (automated checks passed; physical checks remain T19.4)
- [x] [T19.4 — Browser and physical-device verification](T19-4-pwa-and-device-verification.md) (Android/PC and automated checks passed; owner-approved iPhone deferral to T21)

The first checkpoint should produce an installable production build without
adding offline caching. The second introduces the service worker and update
policy. The third makes small, evidence-driven presentation adjustments. The last
checks the assembled flow and records actual device evidence and coverage limits.

## Boundaries and defaults

- Use the existing Robot Puzzle name and original minimal robot-themed assets.
  No branding redesign, app store distribution or separate native application.
- Prefer standalone display. Do not promise removal of OS status/gesture bars,
  force orientation, or depend on fullscreen or wake-lock APIs for gameplay.
- Keep normal browser links and `/room/:code` invitations working. Launching an
  installed app must not silently create/join a room, allocate a new identity,
  discard an uncertain command, or override an intentional Leave.
- Never assume browser tabs and installed apps share credentials or per-tab
  storage. Inspect actual behavior and report identity-context differences; do
  not invent credential transfer or change the fixed 24-hour identity lifetime.
- Cache no `/api` traffic, authenticated replies, room snapshots, credentials,
  command receipts, solver proofs or live game state. No offline command queue,
  Background Sync submission, optimistic acceptance or offline multiplayer.
- Keep existing server deadlines, bid rules, grace, expiry, scoring and position
  ownership unchanged. Installation does not pause a match or renew identity.
- No new runtime dependency by default. If a PWA/build library is justified,
  propose its purpose/version and obtain approval before installation. Verify
  current browser/build requirements against official documentation when coding.
- Preserve ordinary development/HMR and existing isolated browser tests. Do not
  install a production service worker in normal development by default or remove
  unrelated origin caches, browser data, certificates or running processes.

## Completion evidence

Record changed files, exact commands/results and browser/device versions where
available. Verify a production build over approved same-origin HTTPS, not merely
a Vite development page. Existing test-only TLS exceptions do not establish that
physical-device installation trusts the origin.

Acceptance: browser and invitation links still work; supported devices can install
and launch standalone; an already cached shell explains offline limitations;
fresh server synchronization is required before live actions; updates do not
silently reload a match; lock/resume and network recovery preserve authoritative
state and exact retries. Keep square-board/touch-target requirements intact.

Physical iPhone Safari remains an outstanding coverage item from T18. Desktop
WebKit or mobile emulation is not a physical iPhone pass. If hardware or trusted
HTTPS is unavailable, report the blocked checks and ask before closing T19 with
accepted limits. T20 owns the broader security/operational audit; T21 owns actual
hosting, provider configuration, deployment and public HTTPS smoke tests.
