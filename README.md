# Robot Puzzle

Initial TypeScript workspace. Gameplay and multiplayer are not implemented yet.

## Local setup

Use Node.js 20.19+ (or a newer supported LTS release) and pnpm 12.14.0.

```sh
pnpm install
pnpm dev
```

Vite prints the local development URL. To test from another device on your
network, run `pnpm dev --host 0.0.0.0`.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

`pnpm preview` serves the production build locally after `pnpm build`.
For engine tests in watch mode, run `pnpm --filter @robot-puzzle/game-engine test:watch`.

## Packages

- `apps/web`: minimal React + Vite application.
- `apps/server`: Cloudflare server entry point placeholder; platform integration
  will be added in later multiplayer tasks.
- `packages/game-engine`: pure TypeScript game model and validation rules.
- `packages/shared`: placeholder for runtime-validated network contracts.
- `packages/puzzles`: placeholder for quadrant data and puzzle-validation tools.

The non-web workspaces use pure TypeScript entry points and Vitest. Workspace
consumers use TypeScript source directly through package exports; no separate
package builds are needed yet. Their configs have no DOM library or ambient
runtime types, and tests run in Vitest's default Node environment.

Product requirements, architecture, and the roadmap are in `docs/`.
