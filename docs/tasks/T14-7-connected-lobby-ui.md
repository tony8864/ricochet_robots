# T14.7 — Connected Lobby UI

## Status and scope

Implemented on 2026-10-29 at the owner's request after Create/Join were confirmed
working between PC and Android. Owner visual/live multi-device review remains
pending. No live Start or match gameplay is implemented by this checkpoint.

## Implemented behavior

- Successful Create/Join now enter `ConnectedLobby` instead of the temporary room
  confirmation. Existing-member resume uses the same validated server binding.
- Extracted `LobbyPreview` presentation from the existing development setup, so
  local and connected paths share board, roster and action components while
  keeping their state owners separate. Board rendering/game logic are unchanged.
- A single 46px-high room-code button with a trailing copy icon sits on the right
  above the board, with ROOM CODE above it. Successful copy replaces only the icon
  with a checkmark for 1.5 seconds; the code remains visible. No visible success
  message/toast or permanent instructions. Denial shows brief inline failure text.
  No clipboard reads, permission changes or invite-link
  copy button are added. Existing `/room/CODE` invite entry remains supported.
- A lobby-only WSS adapter uses same-origin browser cookies, validates the initial
  private room/seat binding and every subsequent message, and displays connection
  feedback. It never exposes Act as or authenticates by nickname/code alone.
- Live snapshots supply the roster/online count and catalog board. Older revisions
  cannot overwrite newer state; conflicting equal revisions fail closed and need
  explicit reconnect for an authoritative full rebind, never a client-side merge.
- Shuffle is current-host-only and disabled until bound/connected or while pending.
  Only a snapshot changes the board. Command acknowledgments are correlated and
  wait for the reported current revision before unlocking the next mutation.
- Delayed/lost shuffle results offer Retry Shuffle using the exact original ID,
  lobby context and payload, including after an explicit reconnect. A snapshot
  alone does not acknowledge the command. No optimistic shuffle is performed.
- Start stays disabled with a clear next-step note, even with enough players.
  Guests keep the existing host-waiting message. Unexpected active-match snapshots
  get an explicit unsupported-live-match notice rather than a simulated game.
- Effect cleanup closes sockets, clears timers and invalidates late callbacks.
  Explicit Reconnect reuses membership/cookie; no automatic identity replacement,
  reconnect loop, background recovery, host transfer or seat eviction is added.

## Verification

- Web suite: **206 tests passed**, including socket-adapter, clipboard, connected
  rendering and entry-to-lobby tests. Existing local simulator tests still pass.
- Web TypeScript check and production build passed.
- Existing real Worker socket integration suite: **14 tests passed**, covering
  authenticated connections, broadcasts, shuffle permissions/replay and lifecycle.
  Runner emitted IoContext cancellation and Windows EBUSY temporary-cleanup
  warnings; exit code 0, no failed assertions. No broad cleanup was attempted.
- Browser inspection was attempted using the computer-use skill. Chrome input
  failed with a target-window conflict, then browser activation was denied by
  app permissions. No permissions were changed; no successful interactive visual
  or real frontend-to-Worker test is claimed. Automated UI tests use static markup
  and controlled sockets, separately from the real Worker transport tests.

## Owner review procedure

1. Run the existing Worker and approved HTTPS frontend; do not change Origin or
   certificate trust unless separately requested. Use separate identities/devices.
2. Create on PC, join from phone with that code (nickname required on both).
   Both should open the lobby, show Connected and the same roster/board/code.
3. Check room code/Copy at the upper-right above the square board on narrow
   screens. Tap anywhere on the code button and check that its icon becomes a
   checkmark for 1.5 seconds, keeping the code readable. Check clipboard failure
   feedback if the browser denies the write.
4. Shuffle on the host: both screens must show the same changed board. Guest must
   not see Shuffle/Start. Host Start is visibly unavailable in this checkpoint.
5. Close one client and check the other's online count. Reconnect explicitly after
   a dropped socket; verify same seat, preserved board and no duplicate shuffle.
6. Record physical-phone layout and clipboard observations. Emulation is not
   evidence of real Android/iPhone background/reconnection correctness.

## Remaining boundaries

In-memory membership/retry state still does not survive a full page reload.
T17 owns durable client recovery/automatic mobile reconnection and related policy.
T14.8 owns live Start locking; T15/T16 own match transport. No commit, deployment,
server code change, new dependency or trust/infrastructure change was included.

Room-code design follow-up: the owner confirmed the lobby opens after refreshing
the phone, then requested the single code-button design above. Updated component,
scoped CSS and timer/clipboard tests; 213 web tests and TypeScript/production build
passed. No new physical-device visual check was performed in this follow-up.
