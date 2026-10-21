import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { puzzleCatalog } from '../src/catalog';
import { prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET, type RoundSetupInput, type RoundSetupResult } from '../src/roundSetup';
import { isolatedRobotsBoard } from '../src/roundSetup/fixtures';
import { replaySolution } from '../src/solver/fixtures';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = resolve(packageRoot, '../..');
const repetitions = 3;

function verify(input: RoundSetupInput, result: RoundSetupResult): void {
  const diagnostics = result.diagnostics;
  assert.ok(diagnostics.totalExpandedStates <= input.budget.maxTotalExpandedStates);
  assert.equal(diagnostics.totalExpandedStates, diagnostics.candidates.reduce((sum, candidate) => sum + candidate.stats.expandedStates, 0));
  let remaining = input.budget.maxTotalExpandedStates;
  for (const candidate of diagnostics.candidates) {
    assert.equal(candidate.limits.maxExpandedStates, Math.min(remaining, input.budget.perCandidate.maxExpandedStates));
    assert.ok(candidate.stats.expandedStates <= candidate.limits.maxExpandedStates);
    assert.ok(candidate.stats.peakStoredStates <= input.budget.perCandidate.maxStoredStates);
    remaining -= candidate.stats.expandedStates;
  }
  if (result.status === 'selected') {
    assert.ok(!input.usedTargetIds.includes(result.round.target.id));
    assert.deepEqual(result.round.roundStartRobots, input.robots);
    replaySolution({ board: input.puzzle.board, robots: input.robots, target: result.round.target }, result.internalProof);
  }
}

test('complete round selection measurements', () => {
  const cases: { id: string; input: RoundSetupInput; expected: RoundSetupResult['status'] }[] = [];
  for (const puzzle of puzzleCatalog) {
    const initial: RoundSetupInput = {
      puzzle, robots: puzzle.initialRobots, usedTargetIds: [],
      candidateOrder: puzzle.targets.map((target) => target.id), budget: RECOMMENDED_ROUND_SETUP_BUDGET,
    };
    cases.push({ id: `${puzzle.id}/initial`, input: initial, expected: 'selected' });
    const first = prepareNextRound(initial);
    assert.equal(first.status, 'selected');
    if (first.status !== 'selected') throw new Error('Missing carry-forward fixture.');
    const robots = replaySolution({ board: puzzle.board, robots: initial.robots, target: first.round.target }, first.internalProof);
    cases.push({
      id: `${puzzle.id}/carry-forward`,
      input: { ...initial, robots, usedTargetIds: [first.round.target.id] }, expected: 'selected',
    });
    cases.push({
      id: `${puzzle.id}/reversed-order`,
      input: { ...initial, candidateOrder: [...initial.candidateOrder].reverse() }, expected: 'selected',
    });
  }
  const constellation = cases.find((entry) => entry.id === 'constellation/initial')!.input;
  const hardId = 'yellow-crescent';
  cases.push({
    id: 'constellation/unknown-then-alternative',
    input: { ...constellation, candidateOrder: [hardId, ...constellation.candidateOrder.filter((id) => id !== hardId)] }, expected: 'selected',
  });
  cases.push({
    id: 'constellation/only-hard-target-remains',
    input: { ...constellation, usedTargetIds: constellation.candidateOrder.filter((id) => id !== hardId) }, expected: 'deferred',
  });
  const starter = cases[0].input;
  cases.push({
    id: 'starter/aggregate-limit',
    input: { ...starter, budget: { perCandidate: { maxExpandedStates: 5, maxStoredStates: 100 }, maxTotalExpandedStates: 8 } }, expected: 'deferred',
  });
  cases.push({
    id: 'starter/storage-limit',
    input: { ...starter, budget: { perCandidate: { maxExpandedStates: 10, maxStoredStates: 1 }, maxTotalExpandedStates: 200 } }, expected: 'deferred',
  });
  cases.push({
    id: 'isolated/all-unreachable',
    input: { ...starter, puzzle: isolatedRobotsBoard, budget: { perCandidate: { maxExpandedStates: 1, maxStoredStates: 1 }, maxTotalExpandedStates: 17 } }, expected: 'unavailable',
  });
  cases.push({ id: 'starter/all-used', input: { ...starter, usedTargetIds: starter.candidateOrder }, expected: 'unavailable' });
  const blueStar = starter.puzzle.targets.find((target) => target.id === 'blue-star')!;
  cases.push({
    id: 'starter/already-complete',
    input: {
      ...starter, usedTargetIds: starter.candidateOrder.filter((id) => id !== blueStar.id),
      robots: { ...starter.robots, blue: blueStar.position },
    }, expected: 'unavailable',
  });

  const rows = cases.map(({ id, input, expected }) => {
    const result = prepareNextRound(input);
    assert.equal(result.status, expected);
    verify(input, result);
    const samples = Array.from({ length: repetitions }, () => {
      const start = performance.now();
      const repeated = prepareNextRound(input);
      const elapsedMs = performance.now() - start;
      const memory = process.memoryUsage();
      assert.deepEqual(repeated, result);
      verify(input, repeated);
      return { elapsedMs, observedHeapUsedBytes: memory.heapUsed, observedRssBytes: memory.rss };
    });
    return {
      id, boardId: input.puzzle.id, robots: input.robots, usedTargetIds: input.usedTargetIds,
      candidateOrder: input.candidateOrder, budget: input.budget, samples, result,
    };
  });
  const fallback = rows.find((row) => row.id === 'constellation/unknown-then-alternative')!.result;
  assert.deepEqual(fallback.diagnostics.candidates.map((candidate) => candidate.status), ['unknown', 'solved']);
  const aggregate = rows.find((row) => row.id === 'starter/aggregate-limit')!.result;
  assert.equal(aggregate.diagnostics.totalExpandedStates, 8);
  assert.deepEqual(aggregate.diagnostics.candidates.map((candidate) => candidate.limits.maxExpandedStates), [5, 3]);

  const times = rows.flatMap((row) => row.samples.map((sample) => sample.elapsedMs)).sort((a, b) => a - b);
  const summary = {
    cases: rows.length,
    selected: rows.filter((row) => row.result.status === 'selected').length,
    deferred: rows.filter((row) => row.result.status === 'deferred').length,
    unavailable: rows.filter((row) => row.result.status === 'unavailable').length,
    medianMs: times[Math.ceil(times.length * 0.5) - 1], p95Ms: times[Math.ceil(times.length * 0.95) - 1], maxMs: times.at(-1),
  };
  const sourceFiles = [
    'src/roundSetup/index.ts', 'src/roundSetup/types.ts', 'src/roundSetup/prepare.ts', 'src/roundSetup/validation.ts',
    'src/roundSetup/fixtures.ts', 'src/validation.ts', 'src/geometry.ts',
    'src/solver/index.ts', 'src/solver/types.ts', 'src/solver/search.ts', 'src/solver/state.ts', 'src/solver/indexedTransitions.ts',
    'src/solver/fixtures.ts', 'benchmarks/roundSetup.benchmark.ts',
  ];
  const hash = createHash('sha256');
  for (const path of sourceFiles) hash.update(path).update(readFileSync(resolve(packageRoot, path), 'utf8').replace(/\r\n/g, '\n'));
  const metadata = {
    measuredAt: new Date().toISOString(), node: process.version, platform: platform(), release: release(), arch: arch(),
    cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim().length > 0,
    warmupsPerCase: 1, repetitions, sourceFiles, sourceSha256: hash.digest('hex'),
    catalogSha256: createHash('sha256').update(JSON.stringify(puzzleCatalog)).digest('hex'),
    method: 'Serial calls; timing includes validation, filtering, all solver calls, witness replay, and snapshots. Independent post-call assertions and replay excluded. Process memory snapshots are not per-call peaks. No forced GC.',
  };
  const directory = resolve(repoRoot, 'docs/benchmarks');
  mkdirSync(directory, { recursive: true });
  const header = JSON.stringify({ metadata, summary }, null, 2);
  writeFileSync(resolve(directory, 'T10-round-setup-results.json'), header.slice(0, -2) + ',\n  "cases": [\n' + rows.map((row) => '    ' + JSON.stringify(row)).join(',\n') + '\n  ]\n}\n');
  console.log(JSON.stringify({ summary, report: 'docs/benchmarks/T10-round-setup-results.json' }));
}, 60_000);
