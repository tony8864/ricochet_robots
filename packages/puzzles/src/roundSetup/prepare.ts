import {
  isTargetComplete, moveRobot,
  type GameState, type RobotPositions, type Target,
} from '@robot-puzzle/game-engine';
import type { solvePuzzle, SolverLimits, SolverMove, SolverStats } from '../solver';
import type { CandidateDiagnostic, RoundSetupInput, RoundSetupResult } from './types';
import { validateRoundSetupInput } from './validation';

function copyRobots(robots: RobotPositions): RobotPositions {
  return { red: { ...robots.red }, blue: { ...robots.blue }, green: { ...robots.green }, yellow: { ...robots.yellow } };
}

function verifyProof(input: GameState, moves: readonly SolverMove[]): void {
  if (moves.length === 0) throw new Error('Invalid round setup proof: eligible target requires at least one move.');
  let robots = input.robots;
  for (const move of moves) {
    const result = moveRobot(input.board, robots, move.robotId, move.direction);
    if (!result.moved) throw new Error('Invalid round setup proof: no-op move.');
    robots = result.robots;
  }
  if (!isTargetComplete(robots, input.target)) throw new Error('Invalid round setup proof: target was not completed.');
}

function checkSolverStats(stats: SolverStats, limits: SolverLimits): void {
  if (
    !Number.isSafeInteger(stats.expandedStates) || stats.expandedStates < 0 || stats.expandedStates > limits.maxExpandedStates ||
    !Number.isSafeInteger(stats.peakStoredStates) || stats.peakStoredStates < 1 || stats.peakStoredStates > limits.maxStoredStates
  ) throw new Error('Round setup solver returned statistics outside its budget.');
}

/** Internal solver seam for controlled budget tests; not exported by the package. */
export function prepareRoundWithSolver(input: RoundSetupInput, solver: typeof solvePuzzle): RoundSetupResult {
  validateRoundSetupInput(input);
  const { puzzle, robots, budget } = input;
  const used = new Set(input.usedTargetIds);
  const byId = new Map(puzzle.targets.map((target) => [target.id, target]));
  const eligible: Target[] = [];
  let alreadyComplete = 0;
  for (const id of input.candidateOrder) {
    if (used.has(id)) continue;
    const target = byId.get(id)!;
    if (isTargetComplete(robots, target)) alreadyComplete++;
    else eligible.push(target);
  }

  const candidates: CandidateDiagnostic[] = [];
  let totalExpandedStates = 0;
  const diagnostics = () => ({
    totalTargets: puzzle.targets.length, usedTargetCount: used.size,
    alreadyCompleteTargetCount: alreadyComplete, eligibleTargetCount: eligible.length,
    untestedTargetCount: eligible.length - candidates.length, totalExpandedStates, candidates,
  });
  if (eligible.length === 0) {
    return {
      status: 'unavailable',
      reason: used.size === puzzle.targets.length ? 'all-targets-used' : 'all-unused-targets-complete',
      diagnostics: diagnostics(),
    };
  }

  for (const target of eligible) {
    const allowance = Math.min(budget.perCandidate.maxExpandedStates, budget.maxTotalExpandedStates - totalExpandedStates);
    if (allowance === 0) break;
    const limits: SolverLimits = { ...budget.perCandidate, maxExpandedStates: allowance };
    const state: GameState = { board: puzzle.board, robots, target };
    const result = solver(state, limits);
    checkSolverStats(result.stats, limits);
    totalExpandedStates += result.stats.expandedStates;
    const common = { targetId: target.id, limits, stats: { ...result.stats } };
    candidates.push(result.status === 'unknown'
      ? { ...common, status: result.status, reason: result.reason }
      : { ...common, status: result.status });
    if (result.status === 'solved') {
      verifyProof(state, result.moves);
      return {
        status: 'selected',
        round: {
          boardId: puzzle.id,
          target: { ...target, position: { ...target.position } },
          roundStartRobots: copyRobots(robots),
        },
        internalProof: result.moves.map((move) => ({ ...move })),
        diagnostics: diagnostics(),
      };
    }
  }
  if (candidates.length < eligible.length) {
    return {
      status: 'deferred',
      reason: budget.perCandidate.maxExpandedStates === 0 ? 'candidate-expansion-limit' : 'total-expansion-limit',
      diagnostics: diagnostics(),
    };
  }
  return candidates.some((candidate) => candidate.status === 'unknown')
    ? { status: 'deferred', reason: 'unverified-candidates', diagnostics: diagnostics() }
    : { status: 'unavailable', reason: 'all-eligible-targets-unsolvable', diagnostics: diagnostics() };
}
