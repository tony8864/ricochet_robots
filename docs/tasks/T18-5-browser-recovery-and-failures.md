# T18.5 — Browser Recovery and Failures

Status: implemented and verified (2026-11-02).
Depends on T18.4. Parent: [T18](T18-end-to-end-multiplayer-tests.md).

## Scope

- Exercise actual browser offline/online, refresh and same-identity two-tab
  behavior. Assert read-only recovery, no duplicate seat and fixed host authority.
- Cover an accepted-but-unacknowledged action via a reviewed bounded transport
  interception: original pending request survives refresh and exact Retry applies
  once. If the runner cannot model this faithfully, record the limitation rather
  than claim existing adapter tests are browser evidence.
- Cover disconnected active bidder return during grace and host-only skip after
  the real server-owned boundary; no premature/automatic skip or score change.
- Guest Leave/return retains seat/bid/attempt; other same-identity tab stays online.
  Host End closes both clients and rejects old code; empty expiry is distinct.
- Test a representative inline connection/entry failure and recovery access
  inside round-result modal/Finished. Diagnose rejected actions without changing
  backend rules or broadly disabling checks.
- Reuse existing durable-restart suites; only claim browser-plus-process restart
  if actually exercised with isolated persistent storage and server ownership.

## Acceptance and checks

Failures are reproducible and do not diverge scores, turns, positions or pending
command identity. Use controlled server time, not browser-only clock changes, for
grace/expiry. Keep artifacts ignored/private, tests bounded and sleeps avoided.
Run targeted cases repeatedly to identify flakes, plus workspace regression/type/
build/whitespace checks. Small exposed fixes need their own regression; material
architecture/fairness/security changes require review. Stop before T20 audit.

## Test-only clock and interception review

Recovery cases opt into a separate worker-scoped runtime. The normal production
Worker input graph is still built/checked first and must exclude all test files.
Only that opted-in runtime bundles `apps/server/test/browserRecovery.worker.ts`.
Its monotonic server-time offset and private Durable Object control are available
to the Node runner through Miniflare's namespace API, never an HTTP debug endpoint
or a client clock. The actual Worker routing/authentication stays unchanged;
the special Room tick is private and invokes the real serialized alarm path.
Normal app/dev builds and the other browser tests use production time.

Live connections send ordinary authenticated `state.request` reads before bounded
clock steps, preserving real lease checks instead of faking online flags, ping
sequences or stored state. Nobody is kept alive when testing empty expiry. The
clock accepts validated safe times/room IDs and cannot move time backwards. No
scores, positions, preparation results, budgets or identities are injected.

The transport helper always connects to the actual server using Playwright's
WebSocket interception. It forwards traffic and drops exactly one real move's
acknowledgment while forwarding its accepted snapshot. After refresh the test
compares the exact original/retry move envelopes, receives a real duplicate receipt
and verifies one move, not two. Only bounded action data/public snapshots/safe
metadata are retained; cookies/private binding replies/proofs are not logged.
The proxy also supports a controlled transport close paired with browser offline
state; this is not a claim about undetected half-open mobile TCP connections.

## Browser coverage

Three cases in `tests/recovery.spec.ts` cover:

1. Aborted session bootstrap shows inline connection feedback and retries through
   the real entry UI. Two same-identity tabs share one seat; Cancel/Leave affects
   only one tab, refresh stays at entry, explicit Join restores the seat. Native
   browser offline/online for both roles preserves roster/host; writes disable.
2. Actual accepted-but-unacknowledged move survives refresh/exact Retry once.
   Active-bidder Leave retains bid/attempt/history; rejoin cancels grace and Undo
   still works. Another disconnect leaves controls read-only. Server-owned
   60-second grace is checked before/after eligibility, with no automatic skip;
   canceled then confirmed host skip rolls all robots back and advances once.
   Guest returns to the original seat/turn state. Result-modal recovery remains
   reachable; host End can be canceled, then closes both clients and rejects code.
3. With everyone offline, controlled server time passes the actual 30-minute
   empty deadline. Both browsers learn the distinct expiry reason and old Join
   fails; creating another room reuses the same browser credential (compared as
   a boolean, never dumped). Public debug-clock API remains absent.

The existing full-match browser case additionally takes guest and host offline
inside Finished, checks accessible recovery/disabled host action, restores both
and verifies unchanged standings before the normal lobby-return/fresh-Start path.
This reuses the actual ten-round result, not fabricated Finished data.

Only tests, isolated harness and documentation changed; no application fix,
dependency, production-clock API or gameplay-policy change was needed. Existing
full-runtime restart suites remain separate evidence: this browser script does
not restart a server process with live browsers. Physical Safari/backgrounding,
network half-open timing and the T20 security/resource audit remain separate.

## Verification notes

Targeted recovery cases passed twice (3/3, about 25 seconds per run) after correcting
two test expectations to the existing terminal error wording, including its
"Create or join another room" suffix. A Node/workerd namespace type bridge was
needed for Miniflare's API types; no application response was changed. Workspace
type checks passed. Full `pnpm test:e2e` passed 11/11 cases (about 3.9 minutes),
including the final input-validated clock fixture, all previous normal-time cases
and Finished offline recovery for both roles. Normal production build and
whitespace checks passed. Owned temporary storage was cleaned up; known alarm/
color-environment warnings did not fail the run. Final regression follows below.

Final standalone `pnpm test` passed all 1,530 existing tests, including all 250
Workers tests and 30 independent full-runtime tests. It ran after browser teardown,
not concurrently with the heavy browser suite. Workspace types, normal production
build and whitespace checks passed. Existing Worker shutdown/Windows cleanup
warnings remain; no timeout or search budget was weakened.

Files in this checkpoint: the recovery-only Worker fixture, optional harness clock
and transport helper, three recovery cases, Finished offline steps in the existing
full-match case, and documentation. Earlier work was preserved. No application
logic, public protocol, deployment config, dependency, CA or `.dev.vars` changed.
Nothing committed or deployed; T18.6 device verification remains pending.
