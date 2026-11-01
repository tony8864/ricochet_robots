# T16.3 — Round Results and Next-Round Progression

## Status and purpose

Complete with automated verification and owner acceptance of the normal flow.
Follows [T16.2](T16-2-connected-demonstration-controls.md).
Connect the existing round-result design, Thinking-only Skip and host Continue
to the server. Part of [T16](T16-synchronized-demonstration-and-scoring.md).

## Server scope

1. Route existing `round.skip` and `round.continue` with current authenticated
   host and match/round context. Skip is Thinking-only, before any accepted bid,
   with the existing confirmation flag. Do not confuse it with immediate Give Up
   or permit skipping Bidding/Demonstrating. Preserve serialized bid-vs-skip races.
2. Reuse pure no-bid skip and controller advancement; only the server may translate
   an authorized Continue into the controller action. No client controller input.
3. Continue after rounds 1–9 atomically persists Preparing, queued preparation
   intent, revision and replay outcome. Reuse `queuedPreparation` and current
   official positions/used IDs; do not search synchronously or reset positions.
4. Continue after round 10 atomically enters Finished, with no eleventh target
   search/job. Extend private storage/validation for this state if not already
   supported. T16.4 will connect its final-results presentation.
5. Round Result stays unchanged until an accepted host action. Replays must not
   skip two rounds, queue two jobs or award points on Continue. Existing session/
   preparation alarm obligations and failure/cooldown behavior remain intact.

## Client scope

1. Adapt/reuse the existing centered result modal and established success,
   nobody-solved and skipped messages. Read outcome, names, bid, moves and point
   award from authoritative data; no second score table or new decoration.
2. Only host sees Continue (rounds 1–9) or View Results (round 10). Guests see the
   existing waiting message. Keep action pending until network reconciliation,
   not just until a synchronous callback returns; disable duplicate submissions.
3. Preserve non-dismissible modal/background inertness and accessible focus.
   Connection errors, explicit reconnect and exact pending-request retries must
   remain usable rather than trapped behind an inert overlay. Reuse local modal
   presentation without importing local controller authority or fake private state.
4. Dismiss only on the authoritative transition. If next-round preparation fails,
   use Preparing feedback/Retry, not a result-modal generation error. Do not auto-
   advance after a timeout. Show Skip only in Thinking for host, with confirmation.

## Checks and stop

- Server tests: permissions/stale rounds, simultaneous Skip/bid ordering, duplicate
  Continue/Skip, transaction rollback, exactly one preparation job, all-four official
  carry-forward/unchanged failed-round positions, preparation error preservation,
  final-round Finished and zero eleventh-round search.
- Client tests: every outcome, host/guest/final-round actions, pending/rejection/
  reconnect behavior, modal focus/dismissal, snapshot timing and preparation errors
  outside the result. Run relevant tests/type checks/build and record evidence.
- Owner checkpoint: result on both devices, guests wait, host Continue reveals
  the same next target from the correct positions. Finished can remain an honest
  placeholder until T16.4. Stop before rematch or T17 policies.

## Implementation and verification record

- Existing `round.skip`/`round.continue` requests now use authenticated Room
  serialization and the same replay ledger/caps. Server checks phase, current
  host and exact match/round context. Skip delegates to the pure confirmed
  Thinking-only rule. Bid/Skip serialization accepts only the winning action.
- Continue is translated to pure `round.advance` only after host authorization.
  Rounds 1–9 atomically store Preparing, one `queuedPreparation` job, revision and
  replay outcome without running a solver. Round 10 stores version-5 Finished
  without a job/search. Existing v1–v4 records remain valid; no room reset.
- Corrections/outcomes/scores/official positions remain reducer-owned. Continue
  never scores or resets robots. Tests verify colored/vortex success positions
  and used IDs feed the actual subsequent job request unchanged. Preparation
  errors stay in Preparing with existing host Retry/cooldown feedback.
- The existing `RoundResultModal` accepts only the public presentation fields it
  needs (round number, outcome, roster), preserving compatibility with the local
  simulator. Controlled network pending/disabled props keep Continue/View Results
  unavailable until reconciliation. Guests wait for the named host. No fake
  private attempt state or local controller is introduced.
- The native dialog remains non-dismissible, focuses its panel and restores body
  scrolling on unmount. Connection errors, Reconnect and exact pending-request
  retry are rendered inside the dialog when needed, not trapped behind inert
  content. Ordinary results keep the minimal original layout. The modal unmounts
  only with an authoritative phase change; preparation errors render outside it.
- Host Skip appears only in Thinking, above the board. Its confirmation states
  that no point is awarded, robots remain, the target stays used and the round
  counts. Client rechecks context after confirmation; an intervening bid/phase
  change invalidates it. Give Up is still immediate and unrelated to Skip.
- `pnpm --filter @robot-puzzle/server test`: 187 Worker + 14 full-runtime restart
  tests passed. New focused round tests cover authorization, confirmation/context,
  Skip/bid ordering, exact replay, rollback, one job/no synchronous search,
  preparation error preservation and the final-round boundary. Real authenticated
  two-client WSS coverage continues an exhausted result into round-two Thinking
  with matching snapshots. Restart cases preserve queued subsequent preparation
  and Finished; the latter uses an isolated round-10 fixture, not a ten-round run.
- Web tests: 301 passed, including Skip confirmation/eligibility, Continue
  result/snapshot ordering, pending/rejection/retry/rebind, host/guest/final modal
  states and in-dialog recovery. Shared tests: 390 passed. Match tests: 192 passed.
  Tests are deterministic state/adapter/markup checks, not physical-browser proof.
- Workspace `pnpm typecheck`, production `pnpm build`, and whitespace checks
  passed, including the new untracked task/test files.
- Known Worker IoContext cancellation and Windows EBUSY cleanup warnings remain
  on passing runs. The new failure-path test initially missed alarm cleanup;
  adding awaited cleanup resolved its isolated-storage error. A socket assertion
  was corrected to ignore queued round-one snapshots when awaiting round two.
- No final standings/rematch, automatic mobile recovery, host transfer, preparation
  policy escalation, product-rule change, infrastructure, commit or deployment.

## Owner checkpoint

On PC and phone, confirm the same success/exhaustion/Skip modal, host-only
Continue and guest waiting text; dismiss neither by outside tap nor Escape.
Continue into the same next target with preserved official positions. Check
in-modal explicit reconnect/retry if needed and narrow-screen readability. At
round 10, View Results currently reaches an honest Finished placeholder; final
standings and New Match are T16.4.

After being advised to test by repeatedly using host Skip/Continue through round
10 and View Results, the owner reported "ok it works" and requested the next
step. This records acceptance of that basic flow, not individual confirmation
of every recovery/keyboard/visual case above. Those remain automated coverage or
later device verification; no browser version or iPhone Safari pass was supplied.
