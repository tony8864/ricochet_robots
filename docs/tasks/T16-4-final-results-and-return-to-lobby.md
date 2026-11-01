# T16.4 — Final Results and Return to Lobby

## Status and purpose

Complete with automated verification and owner acceptance.
Follows [T16.3](T16-3-round-results-and-next-round.md).
Complete the connected end-of-match flow using the approved full-screen results
view. Part of [T16](T16-synchronized-demonstration-and-scoring.md).

## Scope

1. Display Finished from the server after round-10 View Results. Reuse existing
   final-results presentation/derived standings, not a second stored scoreboard
   or reconstructed fake private match/history. No local finishing/scoring.
2. Preserve all approved variants: one positive-score leader wins; multiple
   positive-score leaders tie; all zero means No winner, no trophy, dash ranks,
   original roster order and only current-player highlight. Equal positive scores
   share rank with stable order. Use actual round count, never a testing shortcut.
3. Only host has New Match; others wait for that host. Wire existing
   `match.returnToLobby`, binding current match context and identity server-side.
   Serialize/replay it through the shared ledger with safe pending/error feedback.
4. Atomically return to a fresh lobby context while keeping room ID/code, host,
   seats/nicknames, existing identity lifetime and connection semantics. Clear the
   active match/score lifecycle correctly; do not clear the shared replay ledger
   or credential mappings. Do not automatically start round 1.
5. Reuse the approved catalog-preview/lobby setup behavior and explain the concrete
   board-selection choice before coding; do not silently invent a rematch board
   policy. Host can shuffle before Start. Normal lobby capacity/join rules resume;
   no new seats may join while the match is still started/Finished.
6. Ensure old Start/Continue/attempt requests cannot affect the new lobby or next
   match. An exact retained replay still returns its original outcome plus the
   current state. A genuinely new Start creates a new match identity and zero
   scores only after normal host/roster/board checks.
7. Adapt existing result components minimally for controlled network pending state
   and explicit reconnect/retry. Preserve entry/lobby/code-copy/local-simulator
   behavior; do not introduce automatic mobile recovery or host transfer.

## Checks and completion

- Positive winner, positive tie, all-zero display/order/rank/highlight tests.
- Host/guest/wrong-phase/stale-match/replay-conflict checks, duplicate New Match,
  transaction failure, same room/roster/host, fresh lobby/match IDs, stale commands,
  unchanged credential lifetime and clean new-match scores/target history.
- Finished and returned-lobby persistence/rebind tests; two clients see the same
  transition and retain the room code. No unsolicited match start or extra search.
- Relevant server/web/shared tests and type checks, build and whitespace checks.
  Record actual owner final-results/rematch review separately. Stop before T16.5.

## Implementation record

- Reused `MatchResults` and the existing pure standings selector. Their input
  types now require only public display fields, not private match geometry/history.
  Ranking/scoring behavior is unchanged: positive winner/tie, zero-score No winner,
  stable equal-score order, shared ranks and established row highlights.
- New Match sends existing `match.returnToLobby` with the exact Finished match
  ID. Only the authenticated current host can return the room. The server commits
  a fresh lobby UUID, monotonic revision and replay outcome in one transaction,
  removes private/public active match state, and preserves room ID/code, board,
  host, roster, connection flags, identity mappings and non-evicting replay ledger.
- Concrete preview policy was explained before coding: keep the completed board
  in the lobby, matching local `SetupPreview.newMatch`. Host may explicitly
  Shuffle or Start. There is no automatic new match/search or forced board change.
  New Start uses catalog initial positions, new match identity and zero scores/
  completed rounds/used targets. Normal lobby joining becomes available again.
- The adapter shares one immutable pending mutation slot across all actions.
  Results and authoritative revisions reconcile before unlocking. Timeouts expose
  exact retry, including after a lobby snapshot/rebind, without recreating the
  lobby. Start/Shuffle stay disabled until an unresolved return is reconciled.
  Old accepted Start/Continue replays return their original outcome and current
  state; new stale contexts and conflicting IDs cannot affect the new lifecycle.
- Results retain the approved fullscreen layout; only optional disabled/pending
  and recovery feedback were added. Host sees Returning to lobby while pending;
  guests see the named-host waiting message, not a disabled yellow button.
  Explicit Reconnect/retry/errors remain usable on results and after lobby return.
  The local simulator remains separately owned and its results presentation works.
- Tests cover authorization/context/phase/conflict, rollback, one lobby transition,
  preserved private membership/replay records and clean subsequent Start. Live
  authenticated WSS verifies matching two-client lobby snapshots/code, stable
  session issue/expiry and seat rebind, rejected joins during Finished and accepted
  joins after return, and safe replay of the original pre-match Start. An isolated
  Finished fixture is used here, not a claimed ten-round network playthrough.
- Added full-runtime returned-lobby restart coverage alongside existing Finished
  restart checks. Web coverage verifies all three result outcomes, host/guest,
  disconnected/pending/retry UI, exact immutable retries across rebind and both
  acknowledgment/snapshot orderings. No public fixture/test endpoint was added.
- No game-rule, session-lifetime, protocol, preparation-budget, dependency, trust,
  deployment or automatic reconnect/host-transfer change. T16.5 remains separate.

## Automated checks

- `pnpm test`: 1,330 passed — 102 engine, 124 puzzles, 192 match, 390 shared,
  316 web and 206 server (191 Worker plus 15 runtime-restart tests).
- `pnpm typecheck`, `pnpm build` and whitespace checks passed.
- Known Worker IoContext cancellation/Windows EBUSY temporary cleanup warnings
  occurred on passing runs with exit zero. No broad cleanup/storage reset.
- Initial new-test failures were corrected: bootstrap rejection uses its top-level
  reason, lobby action labels contain icon markup, and fixture score arrays accept
  readonly inputs. The final full workspace run passed, not just selected retries.

## Owner checkpoint

On PC and phone, finish a match, compare the final scores/outcome and host/guest
actions, then use New Match. Both should return to the same room/code/roster/host
with a board preview, Shuffle and Start. Check that Start begins a fresh round-one
match with zero scores. Verify explicit reconnect if desired. Exact device/browser
versions, touch/visual quality and a real ten-round multiplayer playthrough are
not inferred from automated state/adapter/markup tests.

After receiving the PC/phone checklist, the owner reported "it works" and
explicitly confirmed that all three result variants display perfectly. This
records general acceptance of the flow and visual acceptance of winner, tie and
No winner. Individual reconnect steps, exact device/browser versions, measured
latency and iPhone Safari were not separately confirmed. Evidence is owner-reported,
not agent-operated device testing; T16.5/T16.6 verification remains separate.
