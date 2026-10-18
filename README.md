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
- `packages/game-engine`: pure TypeScript entry point and Vitest smoke test.
  Workspace consumers use the TypeScript source directly through package exports;
  no separate engine build is needed yet. The engine config has no DOM library
  or ambient runtime types, and tests run in Vitest's default Node environment.

Product requirements, architecture, and the roadmap are in `docs/`.
