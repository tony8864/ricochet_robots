import { defineConfig } from 'vitest/config';

// Deliberately separate from ordinary tests and the production Wrangler entry.
export default defineConfig({
  test: {
    include: ['test/benchmarks/roundSetup.benchmark.ts'],
    testTimeout: 120_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
