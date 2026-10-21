import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import type { GameState } from '@robot-puzzle/game-engine';
import { puzzleCatalog } from '../src/catalog';
import { solvePuzzle, type SolverLimits, type SolverResult } from '../src/solver';
import { createEngineTransition } from '../src/solver/engineTransitions';
import { helperFixture, impossibleFixture, replaySolution } from '../src/solver/fixtures';
import { searchPuzzle } from '../src/solver/search';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = resolve(packageRoot, '../..');
const limits: SolverLimits = { maxExpandedStates: 50_000, maxStoredStates: 150_000 };
const comparisonLimits: SolverLimits = { maxExpandedStates: 1_000, maxStoredStates: 10_000 };
const largerLimits: SolverLimits = { maxExpandedStates: 200_000, maxStoredStates: 500_000 };
const repetitions = 3;
type Category = 'baseline' | 'indexed-comparison' | 'initial' | 'carry-forward' | 'larger-budget' | 'fixture';

interface Row {
  readonly id: string;
  readonly category: Category;
  readonly boardId: string;
  readonly targetId: string;
  readonly limits: SolverLimits;
  readonly samples: readonly {
    elapsedMs: number; heapUsedBefore: number; heapUsedAfter: number;
    arrayBuffersBefore: number; arrayBuffersAfter: number; rssAfter: number;
  }[];
  readonly result: SolverResult;
}

function measure(
  id: string, category: Category, boardId: string, input: GameState,
  budget = limits, solver = solvePuzzle,
): Row {
  const warmup = solver(input, budget);
  if (warmup.status === 'solved') replaySolution(input, warmup.moves);
  const samples: Row['samples'][number][] = [];
  for (let iteration = 0; iteration < repetitions; iteration++) {
    const before = process.memoryUsage();
    const start = performance.now();
    const result = solver(input, budget);
    const elapsedMs = performance.now() - start;
    const after = process.memoryUsage();
    // Validation, allocation, and geometry setup are timed; witness replay is not.
    assert.deepEqual(result, warmup);
    if (result.status === 'solved') replaySolution(input, result.moves);
    samples.push({
      elapsedMs, heapUsedBefore: before.heapUsed, heapUsedAfter: after.heapUsed,
      arrayBuffersBefore: before.arrayBuffers, arrayBuffersAfter: after.arrayBuffers,
      rssAfter: after.rss,
    });
  }
  return { id, category, boardId, targetId: input.target.id, limits: budget, samples, result: warmup };
}

function summarize(rows: readonly Row[]) {
  if (rows.length === 0) return { cases: 0 };
  const times = rows.flatMap((row) => row.samples.map((sample) => sample.elapsedMs)).sort((a, b) => a - b);
  const percentile = (fraction: number) => times[Math.ceil(times.length * fraction) - 1];
  return {
    cases: rows.length,
    solved: rows.filter((row) => row.result.status === 'solved').length,
    unsolvable: rows.filter((row) => row.result.status === 'unsolvable').length,
    unknown: rows.filter((row) => row.result.status === 'unknown').length,
    medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: times.at(-1),
    maxObservedHeapUsedBytes: Math.max(...rows.flatMap((row) => row.samples.map((sample) => sample.heapUsedAfter))),
    maxObservedRssBytes: Math.max(...rows.flatMap((row) => row.samples.map((sample) => sample.rssAfter))),
  };
}

test('reproducible bounded search benchmark (not a timing assertion)', () => {
  const rows: Row[] = [];
  const carryForward: { boardId: string; solvedTargetId: string; proof: SolverResult; robots: GameState['robots'] }[] = [];
  for (const entry of puzzleCatalog) {
    const first = { board: entry.board, robots: entry.initialRobots, target: entry.targets[0] };
    const baseline = measure(`${entry.id}/baseline`, 'baseline', entry.id, first, comparisonLimits,
      (input, budget) => searchPuzzle(input, budget, createEngineTransition));
    const indexed = measure(`${entry.id}/indexed-comparison`, 'indexed-comparison', entry.id, first, comparisonLimits);
    assert.deepEqual(indexed.result, baseline.result);
    rows.push(baseline, indexed);

    let carried: GameState['robots'] | undefined;
    for (const target of entry.targets) {
      const input = { board: entry.board, robots: entry.initialRobots, target };
      const row = measure(`${entry.id}/initial/${target.id}`, 'initial', entry.id, input);
      rows.push(row);
      // This is deterministic benchmark fixture preparation, not round selection.
      if (!carried && target.kind === 'colored' && row.result.status === 'solved' && row.result.moves.length > 0) {
        carried = replaySolution(input, row.result.moves);
        carryForward.push({ boardId: entry.id, solvedTargetId: target.id, proof: row.result, robots: carried });
      }
    }
    assert.ok(carried, `No carry-forward fixture found for ${entry.id}`);
    for (const target of entry.targets) {
      rows.push(measure(`${entry.id}/carry-forward/${target.id}`, 'carry-forward', entry.id,
        { board: entry.board, robots: carried, target }));
    }
    console.log(JSON.stringify({ board: entry.id, ...summarize(rows.filter((row) => row.boardId === entry.id && (row.category === 'initial' || row.category === 'carry-forward'))) }));
  }

  // Diagnostics only: repeat unknown catalog cases at a separately reported cap.
  for (const row of rows.filter((candidate) =>
    (candidate.category === 'initial' || candidate.category === 'carry-forward') && candidate.result.status === 'unknown')) {
    const entry = puzzleCatalog.find((board) => board.id === row.boardId)!;
    const robots = row.category === 'initial'
      ? entry.initialRobots : carryForward.find((state) => state.boardId === row.boardId)!.robots;
    rows.push(measure(`${row.id}/larger-budget`, 'larger-budget', row.boardId,
      { board: entry.board, robots, target: entry.targets.find((target) => target.id === row.targetId)! }, largerLimits));
  }

  const fixtures: [string, GameState, SolverLimits, SolverResult['status']][] = [
    ['helper', helperFixture, limits, 'solved'],
    ['impossible', impossibleFixture, limits, 'unsolvable'],
    ['work-limit', impossibleFixture, { maxExpandedStates: 1, maxStoredStates: 10 }, 'unknown'],
    ['storage-limit', impossibleFixture, { maxExpandedStates: 10, maxStoredStates: 1 }, 'unknown'],
    ['already-complete', { ...helperFixture, robots: replaySolution(helperFixture, [
      { robotId: 'blue', direction: 'up' }, { robotId: 'red', direction: 'right' },
    ]) }, { maxExpandedStates: 0, maxStoredStates: 1 }, 'solved'],
  ];
  for (const [id, input, budget, expected] of fixtures) {
    const row = measure(id, 'fixture', id, input, budget);
    assert.equal(row.result.status, expected);
    rows.push(row);
  }
  const starterProof = rows.find((row) => row.category === 'initial' && row.boardId === 'starter-board' && row.targetId.endsWith('blue-star'))!;
  assert.equal(starterProof.result.status, 'solved');
  if (starterProof.result.status === 'solved') assert.equal(starterProof.result.moves.length, 2);
  assert.equal(rows.filter((row) => row.category === 'initial').length, 85);
  assert.equal(rows.filter((row) => row.category === 'carry-forward').length, 85);

  const sourceFiles = [
    'src/solver/index.ts', 'src/solver/types.ts', 'src/solver/state.ts', 'src/solver/search.ts',
    'src/solver/engineTransitions.ts', 'src/solver/indexedTransitions.ts', 'src/solver/fixtures.ts',
    'benchmarks/solver.benchmark.ts',
  ];
  const sourceHash = createHash('sha256');
  for (const path of sourceFiles) sourceHash.update(path).update(readFileSync(resolve(packageRoot, path), 'utf8').replace(/\r\n/g, '\n'));
  const categories: Category[] = ['baseline', 'indexed-comparison', 'initial', 'carry-forward', 'larger-budget', 'fixture'];
  const summary = Object.fromEntries(categories.map((category) => [category, summarize(rows.filter((row) => row.category === category))]));
  const metadata = {
    measuredAt: new Date().toISOString(),
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    workingTreeDirty: execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim().length > 0,
    sourceFiles, sourceSha256: sourceHash.digest('hex'),
    catalogSha256: createHash('sha256').update(JSON.stringify(puzzleCatalog)).digest('hex'),
    node: process.version, platform: platform(), release: release(), arch: arch(),
    cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(),
    warmupsPerCase: 1, repetitions, limits, comparisonLimits, largerLimits,
    memoryMethod: 'Process snapshots before/after each timed call; no forced GC. Not per-search peaks. Typed-array bytes are exact; Set and JS overhead are not estimated.',
  };
  const reportDirectory = resolve(repoRoot, 'docs/benchmarks');
  mkdirSync(reportDirectory, { recursive: true });
  // Generated evidence: one case per line keeps the raw artifact reviewable.
  const header = JSON.stringify({ metadata, summary, carryForward }, null, 2);
  const output = header.slice(0, -2) + ',\n  "cases": [\n' + rows.map((row) => '    ' + JSON.stringify(row)).join(',\n') + '\n  ]\n}\n';
  writeFileSync(resolve(reportDirectory, 'T09-solvability-results.json'), output);
  console.log(JSON.stringify({ summary, report: 'docs/benchmarks/T09-solvability-results.json' }));
}, 120_000);
