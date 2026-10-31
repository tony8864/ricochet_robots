import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { test } from 'vitest';
import { puzzleCatalog } from '@robot-puzzle/puzzles';
import { prepareNextRound, type RoundSetupInput, type RoundSetupResult } from '@robot-puzzle/puzzles/round-setup';
import { replaySolution } from '../../../../packages/puzzles/src/solver/fixtures';
import { benchmarkCases } from './fixtures';

function verify(input: RoundSetupInput, result: RoundSetupResult): void {
  let remaining = input.budget.maxTotalExpandedStates;
  for (const candidate of result.diagnostics.candidates) {
    assert.equal(candidate.limits.maxExpandedStates, Math.min(remaining, input.budget.perCandidate.maxExpandedStates));
    assert.ok(candidate.stats.expandedStates <= candidate.limits.maxExpandedStates);
    assert.ok(candidate.stats.peakStoredStates <= candidate.limits.maxStoredStates);
    remaining -= candidate.stats.expandedStates;
  }
  assert.ok(remaining >= 0);
  assert.equal(input.budget.maxTotalExpandedStates - remaining, result.diagnostics.totalExpandedStates);
  if (result.status === 'selected') {
    assert.ok(!input.usedTargetIds.includes(result.round.target.id));
    assert.ok(result.internalProof.length > 0);
    assert.deepEqual(result.round.roundStartRobots, input.robots);
    replaySolution({ board: input.puzzle.board, robots: input.robots, target: result.round.target }, result.internalProof);
  }
}

test('measure complete preparation in an isolated local Durable Object', async () => {
  const cases = benchmarkCases(); // Fixture construction/search excluded from measurements.
  const bundle = await build({ entryPoints: ['test/benchmarks/preparation.worker.ts'],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    external: ['cloudflare:workers'], metafile: true,
  });
  const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2025-10-11', host: '127.0.0.1', port: 0,
    durableObjects: { BENCHMARK: { className: 'PreparationBenchmark', useSQLite: true } },
  });
  async function invoke(body: string, baseline = false) {
    const start = performance.now();
    const response = await runtime.dispatchFetch(`https://benchmark.invalid/${baseline ? 'baseline' : 'prepare'}`, {
      method: 'POST', body, headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    const roundTripMs = performance.now() - start;
    const decoded = JSON.parse(text) as { result: RoundSetupResult | null; workerClockElapsedMs: number };
    return { ...decoded, roundTripMs };
  }
  try {
    const baselineBody = JSON.stringify(cases[0].input);
    await invoke(baselineBody, true); // Excludes runtime startup from samples.
    const baselineSamples = [];
    for (let i = 0; i < 5; i++) baselineSamples.push(await invoke(baselineBody, true));
    const rows = [];
    for (const entry of cases) {
      const original = JSON.stringify(entry.input);
      const expected = prepareNextRound(entry.input); // Node parity, outside measured work.
      assert.equal(expected.status, entry.expected, entry.id);
      verify(entry.input, expected);
      const warmup = await invoke(original);
      assert.deepEqual(warmup.result, expected);
      const samples = [];
      for (let i = 0; i < 3; i++) {
        const sample = await invoke(original);
        assert.deepEqual(sample.result, expected, entry.id);
        verify(entry.input, sample.result!);
        samples.push({ roundTripMs: sample.roundTripMs, workerClockElapsedMs: sample.workerClockElapsedMs });
      }
      assert.equal(JSON.stringify(entry.input), original);
      rows.push({ ...entry, samples, result: expected });
      console.log(`${entry.id}: ${expected.status}, ${expected.diagnostics.totalExpandedStates} expansions, ${samples.map((s) => s.roundTripMs.toFixed(2)).join('/')} ms round trip`);
    }
    const stress = rows.find((row) => row.id === 'stress/full-aggregate')!;
    assert.equal(stress.result.diagnostics.totalExpandedStates, 200_000, 'Stress must exercise the entire normal aggregate cap');
    assert.equal(stress.result.diagnostics.candidates.length, 4);
    assert.ok(stress.result.diagnostics.candidates.every((candidate) => candidate.status === 'unknown' && candidate.reason === 'expansion-limit'));
    const hard = rows.find((row) => row.id === 'constellation/hard-first')!;
    assert.deepEqual(hard.result.diagnostics.candidates.map((candidate) => candidate.status), ['unknown', 'solved']);
    const small = rows.find((row) => row.id === 'starter/small-aggregate')!;
    assert.equal(small.result.diagnostics.totalExpandedStates, 8);
    assert.deepEqual(small.result.diagnostics.candidates.map((candidate) => candidate.limits.maxExpandedStates), [5, 3]);
    const times = rows.flatMap((row) => row.samples.map((sample) => sample.roundTripMs)).sort((a, b) => a - b);
    const summary = { cases: rows.length, samples: times.length,
      selected: rows.filter((row) => row.result.status === 'selected').length,
      deferred: rows.filter((row) => row.result.status === 'deferred').length,
      unavailable: rows.filter((row) => row.result.status === 'unavailable').length,
      medianRoundTripMs: times[Math.ceil(times.length * 0.5) - 1],
      p95RoundTripMs: times[Math.ceil(times.length * 0.95) - 1], maxRoundTripMs: times.at(-1),
    };
    const sourceFiles = [...new Set([...Object.keys(bundle.metafile!.inputs),
      'test/benchmarks/fixtures.ts', 'test/benchmarks/roundSetup.benchmark.ts', 'vitest.benchmark.config.ts'])].sort();
    const hash = createHash('sha256');
    for (const path of sourceFiles) hash.update(path).update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
    const version = (name: string) => JSON.parse(readFileSync(resolve('node_modules', name, 'package.json'), 'utf8')).version as string;
    const workerd = JSON.parse(readFileSync('node_modules/miniflare/package.json', 'utf8')).dependencies.workerd as string;
    const metadata = { measuredAt: new Date().toISOString(), node: process.version,
      platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model,
      logicalCpus: cpus().length, miniflare: version('miniflare'), workerd, wrangler: version('wrangler'),
      vitest: version('vitest'), compatibilityDate: '2025-10-11',
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
      warmupsPerCase: 1, repetitions: 3, shuffleSeed: 1501, sourceFiles,
      sourceSha256: hash.digest('hex'), bundleSha256: createHash('sha256').update(bundle.outputFiles[0].text).digest('hex'),
      catalogSha256: createHash('sha256').update(JSON.stringify(puzzleCatalog)).digest('hex'),
      method: 'Serial Node-observed round trips through a test-only Worker and one SQLite-backed Durable Object. Includes transport, JSON, validation, filtering, all searches, proof replay and response. Fixture construction, Node parity assertions and independent post-call verification excluded. Worker performance.now samples reported separately; may be frozen during synchronous work. No CPU or peak-memory metric. No forced GC; no production traffic, storage writes or scheduling.',
    };
    const report = resolve('../../docs/benchmarks/T15-local-workers-results.json');
    // Like T10, keep each full case on one line so raw fixtures remain reviewable.
    const header = JSON.stringify({ metadata, summary, baselineSamples }, null, 2);
    writeFileSync(report, header.slice(0, -2) + ',\n  "cases": [\n' + rows.map((row) => '    ' + JSON.stringify(row)).join(',\n') + '\n  ]\n}\n');
    console.log(JSON.stringify({ summary, report }));
  } finally {
    await runtime.dispose();
  }
});
