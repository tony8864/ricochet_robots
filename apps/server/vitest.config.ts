import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['test/worker.test.ts', 'test/sessions.test.ts', 'test/creations.test.ts', 'test/membership.test.ts', 'test/sockets.test.ts', 'test/presence.test.ts', 'test/start.test.ts', 'test/preparation.test.ts', 'test/bidding.test.ts', 'test/attempts.test.ts', 'test/rounds.test.ts', 'test/fullMatch.test.ts', 'test/roomTerminal.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        isolatedStorage: true,
      },
    },
  },
});
