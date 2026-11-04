# T18.2 — Entry and Lobby Browser Flow

Status: implemented; verification recorded below. Depends on T18.1.
Parent: [T18](T18-end-to-end-multiplayer-tests.md).

## Scope

- Drive two independent player contexts through nickname, Create Room, visible
  code and Join Room. Verify both see the same board/roster with correct You/Host.
- Exercise an invite URL prefilled code, validation feedback and an invalid code.
  Check room-code copying with runner-supported clipboard permissions rather
  than changing production behavior for the test.
- Host shuffles; guest sees the same new board and has no host-only controls.
  Host starts with two players; both leave lobby for the same active match.
- A fresh identity cannot join the started match. The original player refreshing
  still resumes their seat, without a duplicate roster entry.

## Acceptance and checks

Repeatable rendered-browser test(s) establish room/identity separation, shared
lobby state, host-only setup and lock/resume. Wait on visible authoritative state,
not optimistic clicks. Use fresh storage/context per case and ignore artifacts.
Run browser cases plus relevant regression/type/whitespace checks. Record runner
and browser version. Stop before automating the whole match in this checkpoint.

## Implementation and evidence

Added `apps/e2e/tests/lobby.spec.ts` with three rendered-browser cases:

1. Malformed invitation, blank/overlong nickname, invalid code, normalization
   and an unknown valid code produce inline feedback without leaving entry.
2. Host creates through the UI, copies the real code with scoped clipboard
   permissions, and another identity joins by normalized manual code. Both show
   the same rendered board and two-player roster with correct Host/You indicators.
   Start is disabled alone; only the host can Shuffle/Start. A real shuffle changes
   both boards. Start creates the same match in both contexts; a fresh third
   identity is rejected. Guest and host refresh into their original highlighted
   seats, same match/board/host and unchanged two-seat roster.
3. A lowercase invite URL pre-fills the normalized code; nickname entry and Join
   reach the same lobby without copying the code manually.

`support/lobby.ts` contains small accessible-locator/board helpers and observes
only public room snapshots. It does not retain private binding replies/cookies,
inject accepted state or call test-only endpoints. Tests drive the actual UI and
production HTTPS/WSS through the existing isolated harness. No new dependency,
clock hook, selector attribute, game/UI change or backend fix was needed.

The first validation expectation used an outdated 20-character assumption. It
was corrected to reference the existing shared nickname contract (24 code points),
testing the boundary and one above it; the application limit was not changed.
Runner remains Playwright 1.64.1 / Chromium 156.0.8078.4 / Node 20.19.4 on Windows.
This is rendered desktop Chromium at a narrow viewport, not physical phone or
iPhone Safari evidence. Full-round gameplay remains T18.3; ten-round proof T18.4.

## Checks run (2026-11-02)

- `pnpm test:e2e`: 5/5 passed, including repeated fresh-runtime runs and a final
  run with explicit restored-seat highlighting checks.
- `pnpm test`: all 1,530 existing workspace tests passed (server includes 30
  separate full-runtime tests). Browser cases remain separate from this count.
- `pnpm typecheck`, final E2E type check, `pnpm build` and whitespace checks passed.
- Existing Worker shutdown/temporary-cleanup warnings remain; final commands
  exited zero. No production defect or behavior change was needed.

Changes in this checkpoint are the lobby test/helper and documentation. Existing
T18.1 work and other task documents were preserved. Nothing committed or deployed.
