import { puzzleCatalog } from '@robot-puzzle/puzzles';
import {
  prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET,
  type RoundSetupInput, type RoundSetupResult,
} from '@robot-puzzle/puzzles/round-setup';
import { isolatedRobotsBoard } from '../../../../packages/puzzles/src/roundSetup/fixtures';
import { replaySolution } from '../../../../packages/puzzles/src/solver/fixtures';

export interface BenchmarkCase {
  id: string;
  input: RoundSetupInput;
  expected: RoundSetupResult['status'];
}

/** Reproducible Fisher-Yates order; not production randomness. */
function shuffle(ids: readonly string[], seed: number): string[] {
  const result = [...ids];
  let state = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function benchmarkCases(): BenchmarkCase[] {
  const cases: BenchmarkCase[] = [];
  for (const puzzle of puzzleCatalog) {
    const input: RoundSetupInput = {
      puzzle, robots: puzzle.initialRobots, usedTargetIds: [],
      candidateOrder: puzzle.targets.map((target) => target.id),
      budget: RECOMMENDED_ROUND_SETUP_BUDGET,
    };
    cases.push({ id: `${puzzle.id}/initial`, input, expected: 'selected' });
    const first = prepareNextRound(input);
    if (first.status !== 'selected') throw new Error('Missing carry-forward fixture');
    const robots = replaySolution({ board: puzzle.board, robots: input.robots, target: first.round.target }, first.internalProof);
    cases.push({ id: `${puzzle.id}/carry-forward`, input: {
      ...input, robots, usedTargetIds: [first.round.target.id],
    }, expected: 'selected' });
    cases.push({ id: `${puzzle.id}/seed-1501`, input: {
      ...input, candidateOrder: shuffle(input.candidateOrder, 1501),
    }, expected: 'selected' });
  }
  const starter = cases[0].input;
  const constellation = cases.find((entry) => entry.id === 'constellation/initial')!.input;
  const hard = 'yellow-crescent';
  cases.push({ id: 'constellation/hard-first', input: { ...constellation,
    candidateOrder: [hard, ...constellation.candidateOrder.filter((id) => id !== hard)],
  }, expected: 'selected' });
  cases.push({ id: 'constellation/only-hard', input: { ...constellation,
    usedTargetIds: constellation.candidateOrder.filter((id) => id !== hard),
  }, expected: 'deferred' });
  cases.push({ id: 'starter/small-aggregate', input: { ...starter, budget: {
    perCandidate: { maxExpandedStates: 5, maxStoredStates: 100 }, maxTotalExpandedStates: 8,
  } }, expected: 'deferred' });
  cases.push({ id: 'starter/storage-limit', input: { ...starter, budget: {
    perCandidate: { maxExpandedStates: 10, maxStoredStates: 1 }, maxTotalExpandedStates: 200,
  } }, expected: 'deferred' });
  cases.push({ id: 'isolated/unreachable', input: { ...starter, puzzle: isolatedRobotsBoard }, expected: 'unavailable' });
  cases.push({ id: 'starter/all-used', input: { ...starter, usedTargetIds: starter.candidateOrder }, expected: 'unavailable' });
  const target = starter.puzzle.targets.find((entry) => entry.id === 'blue-star')!;
  cases.push({ id: 'starter/already-complete', input: { ...starter,
    usedTargetIds: starter.candidateOrder.filter((id) => id !== target.id),
    robots: { ...starter.robots, blue: target.position },
  }, expected: 'unavailable' });

  // Catalog-valid, non-playable stress design: red is trapped, other robots can
  // move. Four unreachable red targets force bounded searches rather than an
  // immediate immobile-state exhaustion. Never register this in the catalog.
  const trapped = { ...starter.puzzle, id: 'benchmark-trapped-red',
    name: 'Benchmark trapped red', board: { ...starter.puzzle.board,
      walls: [
        ...starter.puzzle.board.walls,
        { first: { row: 0, column: 0 }, second: { row: 0, column: 1 } },
        { first: { row: 0, column: 0 }, second: { row: 1, column: 0 } },
      ],
    },
  };
  cases.push({ id: 'stress/full-aggregate', input: { ...starter, puzzle: trapped,
    usedTargetIds: starter.puzzle.targets.filter((entry) => entry.kind !== 'colored' || entry.robotId !== 'red').map((entry) => entry.id),
  }, expected: 'deferred' });
  return cases;
}
