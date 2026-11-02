import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/persistence.test.ts', 'test/preparationRestart.test.ts', 'test/clientRecovery.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
