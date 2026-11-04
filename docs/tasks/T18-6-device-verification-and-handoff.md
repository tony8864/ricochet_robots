# T18.6 — Device Verification and Handoff

Status: complete with documented limits accepted by the owner (2026-11-04).
Automated verification passed (2026-11-03); all seven guided PC/phone checks were
reported passed (2026-11-04). Untested coverage remains unverified, not waived into
a passing test result.
Depends on T18.1–T18.5. Parent: [T18](T18-end-to-end-multiplayer-tests.md).

## Scope

- Run the full browser suite and workspace tests/types/build/whitespace checks;
  record commands, versions, actual counts, repeat-run failures/fixes and warnings.
- List manual checks first, then guide one at a time using the existing approved
  HTTPS PC/phone setup. Capture device/OS/browser versions and host/guest roles.
- Two real devices complete a ten-round match without divergent board, turns or
  scores. Include actual bids/movement/corrections, failure rollback and a success
  whose final robot positions carry forward; finish results and return to lobby.
- Check Wi-Fi loss, lock/background/resume, refresh including modal/Finished,
  multi-tab presence, host absence, grace/cancel/skip, Leave/return, End and expiry.
  Reference earlier T17 evidence explicitly; do not relabel it as newly repeated.
- Exercise 2–6 participants where practical. Record what was actually tested,
  including reversed host/device roles and iPhone Safari if available. Emulated
  mobile/WebKit is separate evidence, never a physical iPhone pass.
- Confirm narrow-screen square board, readable controls, reachable recovery and
  minimum touch targets without using this task for a new layout redesign.

## Acceptance and handoff

Publish a coverage/evidence table distinguishing unit/adapter tests, rendered
browser automation, independent runtime restart and physical-device reports.
Keep missing device cases open or get explicit owner acceptance of limits.
Never install/change CAs, firewall, deployment or hosted infrastructure as an
implicit testing step. Do not claim production security/resource certification.

Update T18 task statuses, plan and relevant testing documentation to actual
evidence. Report reproducible bugs/limitations and whether the milestone's
two-real-device gate passed. Stop before commit, T19/PWA changes, T20 audit or
T21 deployment unless separately requested.

## Guided device checklist

Run one checkpoint at a time on the existing approved HTTPS setup. No CA,
firewall, tunnel or server configuration change is authorized by this checklist.
Use a fresh room; verify normal ten rounds/60-second bidding and remove any local
expiry test override before the ordinary match. A read-only check found no active
`LOCAL_EMPTY_ROOM_TIMEOUT_SECONDS` assignment; agent did not edit `.dev.vars`.

1. Record device/OS/browser versions and roles; create on PC, join from phone.
   Both must show the same square board, code, two seats and two online players.
   Check readable controls, comfortable touch targets and reachable menus.
2. Play a genuine ten-round mixed match on both devices. Include accepted bids,
   actual movement, Undo/Reset, a Give Up after moving and a successful solution.
   Verify rollback and that all changed robot positions carry into the next round.
   Skips may finish remaining rounds, but ten skips alone do not pass this gate.
3. Confirm identical final standings, refresh both result screens, then host New
   Match returns the same players/code/host to lobby; explicit Start is fresh.
4. Check refresh during bidding/attempt, Wi-Fi recovery, lock/background/resume,
   two tabs and host absence without transfer; ensure recovery is reachable inside
   round-result and Finished. Earlier T17 reports may be referenced explicitly.
5. Check grace return/cancel/host skip, guest Leave/return, host End/code rejection
   and expiry; do not wait 30 minutes unnecessarily if relying on the separately
   recorded T17 short-timeout result. Any fresh shortened test must be labeled and
   restored afterward, never passed off as a timed production observation.
6. Where practical, reverse device roles and try 3–6 real participants and iPhone
   Safari. Record unavailable coverage or request explicit acceptance of limits.

## Evidence matrix

| Evidence layer | Result and boundary |
| --- | --- |
| Rendered browser automation | Fresh final `pnpm test:e2e`: 11/11 passed (about 3.9 minutes); actual ten-round mixed game/rematch, six contexts, recovery/terminal cases |
| Pure engine/match, contracts, server and adapters | Fresh `pnpm test`: 1,530 passed; engine 102, puzzles 124, match 193, shared 414, web 417, Workers 250, separate runtime tests 30 |
| Independent server runtime recreation | Separate 30-test runtime suite passed (included in 1,530); not a browser-plus-process restart claim |
| Type/build/whitespace | Fresh workspace type checks, normal web production build and whitespace checks passed |
| Physical PC/phone recovery | Owner confirmed the T18.6 seven-step checklist, including connectivity loss/return, lock/unlock and refresh; multi-tab/host-absence details remain earlier T17 evidence |
| Physical grace/Leave/End/expiry | Earlier T17 core reports; expiry used a labeled 10-second local override, not an observed 30-minute wait |
| Fresh two-real-device mixed ten-round match | Owner reported all seven guided checks working on 2026-11-04: bids, movement/corrections, rollback, success/carry-forward, ten-round results/refresh and same-room rematch. Core two-real-device gate passed by owner report, not agent observation |
| iPhone Safari / reverse roles / 3–6 real players | Not verified; six automated contexts are not six physical devices |
| Native layout and touch usability | Owner reported no issues in the guided checklist. Existing CSS declares 44px-or-larger primary button minima; native pixel measurements/viewport dimensions were not supplied |

## Environment and current device record

- Automated host: Windows; Node 20.19.4 verified in the host execution environment.
  Playwright 1.64.1; bundled Chromium/headless-shell 156.0.8078.4, revision 1248
  (installed manifest and prior executable verification). Vite build 7.3.7.
- Manual PC browser/version: requested, not supplied yet.
- Manual phone: earlier Galaxy A36 5G / Android 15 report; current model, OS and
  browser versions requested for reconfirmation. Do not infer current versions.
- Tested roles follow the guided PC-host/phone-guest checklist, confirmed by the
  owner's report. No physical device was operated by the agent. Exact current
  browser/OS versions and reconfirmed phone model were not supplied.

## Reliability notes and stop point

The final browser run passed with known Miniflare alarm-cancellation and Node
color-environment warnings. Earlier T18.3 hit an existing full-match timeout in
an overlapping run; standalone rerun passed without increasing timeouts/budgets.
That history remains a reliability note, not a proven root-cause fix. Tests are
run sequentially here. Windows temporary-cleanup/Worker shutdown warnings and
toolchain/resource limits remain documented in browser/local-development notes.

Recovery-only controlled time is private to a separate test Worker; production
builds/routing retain real clocks and no debug API. Browser scripts do not prove
physical Safari suspension, arbitrary carry-forward target supply, native trust,
hosted cost/security or a live-browser server process restart. T19/T20/T21 remain
separate. No code, dependency, trust, deployment or live-room change was needed
in this verification. Keep T18.6 open until device evidence or explicit acceptance
of outstanding limits; nothing is committed or deployed automatically.

## Final automated check log (2026-11-03)

- `pnpm test:e2e`: 11 passed, no retries/skipped cases; normal-time full-match
  and round flows plus recovery-only controlled-time checks.
- `pnpm test`: 1,530 passed, run after browser teardown; no new timeout or failure.
- `pnpm typecheck`, `pnpm build`, `git diff --check`: passed.
- No application/test-code fix was required in T18.6. Only verification/handoff
  documentation was updated; existing dirty implementation/task files preserved.
- Current device/browser details were requested but remain unsupplied. The owner
  subsequently confirmed the guided gameplay checklist as recorded below.

## Owner device report (2026-11-04)

After being given seven guided steps, the owner replied: "they all work fine."
Record all seven as owner-reported passes: fresh room/join with shared state,
start/bids/lowering, movement/Undo/Reset/Give Up rollback, successful solution and
all-four carry-forward, phone recovery, ten-round final results/refresh, and
same-room lobby return/fresh match. No new bug was reported; no code fix or test
rerun was needed for this documentation-only update. Whitespace was checked.

Core automated and two-real-device verification has passed. Do not expand that
report into fresh grace/Leave/End/expiry, reverse-role, physical iPhone or 3–6-player
evidence: those were not in the seven newly confirmed steps. Earlier T17 reports
remain separately labeled. On 2026-11-04 the owner explicitly agreed to close T18
with iPhone Safari, reversed roles, 3–6 real players and exact browser versions
remaining unverified. T18/T18.6 are complete for this accepted scope. Missing
coverage remains documented for later review; no commit, deployment or next task
is authorized by this acceptance.
