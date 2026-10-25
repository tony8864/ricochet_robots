# Robot Puzzle

TypeScript workspace with a pure game/match model and local demonstration.
Authoritative multiplayer is not implemented yet.

## Local setup

Use Node.js 20.19+ (or a newer supported LTS release) and pnpm 12.14.0.

```sh
pnpm install
pnpm dev
```

Vite prints the local development URL. To test from another device on your
network, run `pnpm dev --host 0.0.0.0`.

## Local match demonstration (T12.1)

Run `pnpm dev`. The temporary development starter creates a real match on the
configured catalog board, verifies its first target, submits bids for Maria (10)
and Alex (12), and advances supplied time to bidding expiry before rendering.
The simulated clock is fixed at 61,000 ms; this checkpoint has no live countdown.
No proof is displayed or automatically demonstrated.

- **Act as Maria (Host)** starts with movement controls enabled.
- **Act as Alex** or **Teo** watches the same attempt without movement controls.
- Maria's **Give Up** restores all robots for Alex. Switch to Alex to control
  that attempt; Maria is now an inactive host and cannot override Alex.
- Success or exhausted bidders enters a minimal Round Result placeholder.
  Setup, bidding, and result/Continue panels are later T12 subtasks. Reload the
  page to rerun this temporary scenario; it has no persistence.

Change the temporary board only in `apps/web/src/local/config.ts` (`DEMO_BOARD_ID`),
which is also shared by legacy board-rendering fixtures. T12.2 will replace the
starter with host-controlled board setup. Local player switching is not real
authentication, joining, or offline multiplayer. The starter is dev-only:
`pnpm preview` currently shows a production placeholder, not the simulated match.

The controller is created before React rendering, so StrictMode subscriptions/
renders cannot start another match or rerun target selection. Tests inject time
and exercise the public T11 API; React owns only presentation state.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

`pnpm preview` serves the production build locally after `pnpm build`.
For engine tests in watch mode, run `pnpm --filter @robot-puzzle/game-engine test:watch`.

## Packages

- `apps/web`: React + Vite local board and match-driven demonstration.
- `apps/server`: Cloudflare server entry point placeholder; platform integration
  will be added in later multiplayer tasks.
- `packages/game-engine`: pure TypeScript game model and validation rules.
- `packages/shared`: placeholder for runtime-validated network contracts.
- `packages/puzzles`: full-board catalog, bounded solver, and verified round setup.
- `packages/match`: pure match lifecycle, bids, attempts, scoring, and results.

The non-web workspaces use pure TypeScript entry points and Vitest. Workspace
consumers use TypeScript source directly through package exports; no separate
package builds are needed yet. Their configs have no DOM library or ambient
runtime types, and tests run in Vitest's default Node environment.

Product requirements, architecture, and the roadmap are in `docs/`.
