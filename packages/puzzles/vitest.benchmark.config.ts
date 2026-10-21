import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['benchmarks/*.benchmark.ts'],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
