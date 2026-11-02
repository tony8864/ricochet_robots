# T17.5 — Guest Leave Room

Status: implemented; automated checks passed on 2026-11-02. Owner subsequently
confirmed core Cancel, departure/refresh/rejoin, bid retention, demonstration/Undo
retention and round-result departure checks. Exact devices/browser versions and
the separate multi-tab check were not recorded. Uses approved T17.1 semantics.
Parent: [T17](T17-reconnection-and-room-lifecycle.md).

- Implement only the reviewed departure policy, including its multi-tab scope,
  seat reservation, roster behavior and active-bidder grace interaction.
- Add Leave Room and its confirmation for guests in lobby and match headers.
  Extend the compact dropdown without changing header height or board dimensions.
  Close the menu before confirmation; cancellation must do nothing.
- Confirmed departure returns to entry without an automatic reconnect loop.
  Preserve nickname convenience and never clear/reissue the shared identity as
  a shortcut. The host has no Leave Room action.
- If server mutation is required by the approved semantics, validate/authorize it,
  persist/replay atomically and safely reconcile a lost reply; local navigation
  alone must not masquerade as confirmed server membership removal.

Test cancel/confirm, pending/disconnected cases, refresh, multiple tabs, rejoin,
active/inactive bids, no late replacement and no host authority change. Do not
implement permanent departure or score deletion without approval.

## Implementation and evidence

- Shared compact dropdown offers guests Leave Room in every phase. Round Result
  and Finished expose it inside their accessible content, not behind the inert
  result modal. Host Skip Round remains Thinking-only; no host Leave/End added.
- Native modal confirmation supplies inertness, Cancel/Escape and initial Cancel
  focus. The menu closes first. Nested modal scroll locks release in either
  cleanup order; phase changes keep confirmation above a newly opened result.
- Confirm stops only this client's transport, recovery, probes and lifecycle
  listeners; stale callbacks are ignored. Entry remounts with nickname convenience
  intact. No cookie clearing, identity issuance, membership command, seat deletion,
  Give Up, score reset or host transfer. Board renderer/geometry is unchanged.
- Validated tab storage keeps the exact unresolved request plus `autoResume:
  false`. Refresh stays at entry; explicit authenticated rejoin enables recovery
  again and offers exact Retry. Confirmation explains that leaving does not cancel
  a request which may already be accepted.
- If this record cannot be persisted, Leave is refused with an inline error and
  the room remains open, rather than losing an uncertain action or falsely
  promising refresh suppression while browser storage is blocked.
- **393 web tests passed**; **4 real frontend-adapter/Worker HTTP/WSS recovery
  tests passed**, including two-tab/last-tab departure, explicit same-seat rejoin
  after lock, unchanged accepted bids/attempt, and lost-move-reply exact retry.
  Workspace type checks, production build and whitespace checks passed. The full
  workspace test suite was not rerun for this frontend-only production change.
  Existing workerd alarm-cancellation warnings occurred in controlled-clock tests.

T17.4 was not yet implemented when this departure step was delivered; its later
implementation now adds 60-second grace/confirmed host skip to the same presence
path. Leave never implicitly forfeits. T17.6 host closure and T17.7 expiry remain
separate. T17.5 itself required no backend production or protocol change.

## Remaining manual checks

1. Guest menu overlays rather than moving the board. Host never has Leave.
2. Leave opens confirmation after menu dismissal. Cancel/Escape returns focus
   without leaving; tapping outside does not confirm.
3. Confirm returns to entry with nickname remembered; refresh stays there.
   Entering the same code rejoins the same seat.
4. Repeat disconnected/pending and during bidding, demonstration and results.
   An unresolved action is only explicitly retried after rejoin, never auto-sent.
5. Two guest tabs: leaving one keeps the seat online; leaving the last marks it
   offline without removing its row, bids or points.
6. Check narrow phone portrait, focus and scrolling, including a result arriving
   while the Leave confirmation is open. No physical-device pass is claimed.
