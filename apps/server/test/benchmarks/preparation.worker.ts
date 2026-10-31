import { DurableObject } from 'cloudflare:workers';
import { prepareNextRound, type RoundSetupInput } from '@robot-puzzle/puzzles/round-setup';

/** Test-only entry: never imported by src/index.ts or production Wrangler. */
export class PreparationBenchmark extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const input = await request.json() as RoundSetupInput;
    const before = JSON.stringify(input);
    const start = performance.now();
    const result = new URL(request.url).pathname === '/baseline' ? null : prepareNextRound(input);
    const workerClockElapsedMs = performance.now() - start;
    if (before !== JSON.stringify(input)) throw new Error('Preparation mutated its input');
    return Response.json({ result, workerClockElapsedMs });
  }
}

export default {
  fetch(request: Request, env: { BENCHMARK: DurableObjectNamespace }): Promise<Response> {
    return env.BENCHMARK.get(env.BENCHMARK.idFromName('serial-benchmark')).fetch(request);
  },
};
