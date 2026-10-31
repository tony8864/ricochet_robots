import {
  DIRECTIONS, ROBOT_IDS, isTargetComplete, moveRobot, validateGameState,
} from '@robot-puzzle/game-engine';
import { prepareNextRound, type RoundSetupDiagnostics, type RoundSetupResult } from '@robot-puzzle/puzzles/round-setup';
import type { MatchTransitionResult, RoundPreparationOptions, RoundPreparationRequest } from './commands';
import { copyPuzzle, copyRobots, copyTarget, samePuzzle, sameRobots, sameTarget } from './data';
import type { MatchRejectionReason } from './commands';
import { MATCH_ROUND_COUNT, type MatchState, type PreparationStatus, type PreparingMatchState, type RoundNumber } from './model';

function reject(state: MatchState, reason: MatchRejectionReason): MatchTransitionResult {
  return { state, outcome: { status: 'rejected', reason } };
}

function preparationRejection(state: MatchState): MatchRejectionReason | undefined {
  if (state.phase !== 'preparing') return state.phase === 'finished' ? 'match-finished' : 'wrong-phase';
  if (!Number.isInteger(state.completedRounds) || state.completedRounds < 0 || state.completedRounds >= MATCH_ROUND_COUNT ||
    state.usedTargetIds.length !== state.completedRounds) return 'invalid-preparation';
  return undefined;
}

/** Trusted controller snapshot builder; T10 validates ordering and numeric budgets. */
export function snapshotRoundPreparation(state: PreparingMatchState, options: RoundPreparationOptions): RoundPreparationRequest {
  if (!options || !Array.isArray(options.candidateOrder) || !options.budget?.perCandidate) {
    throw new TypeError('Round preparation requires candidateOrder and an explicit budget.');
  }
  return {
    matchId: state.matchId, completedRounds: state.completedRounds,
    setup: {
      puzzle: copyPuzzle(state.puzzle), robots: copyRobots(state.officialRobots), usedTargetIds: [...state.usedTargetIds],
      candidateOrder: [...options.candidateOrder],
      budget: {
        maxTotalExpandedStates: options.budget.maxTotalExpandedStates,
        perCandidate: {
          maxExpandedStates: options.budget.perCandidate.maxExpandedStates,
          maxStoredStates: options.budget.perCandidate.maxStoredStates,
        },
      },
    },
  };
}

function matchesCurrentPreparation(state: PreparingMatchState, request: RoundPreparationRequest): boolean {
  return request.matchId === state.matchId && request.completedRounds === state.completedRounds &&
    samePuzzle(request.setup.puzzle, state.puzzle) && sameRobots(request.setup.robots, state.officialRobots) &&
    request.setup.usedTargetIds.length === state.usedTargetIds.length &&
    request.setup.usedTargetIds.every((id, index) => id === state.usedTargetIds[index]);
}

function validSelectedResult(state: PreparingMatchState, result: Extract<RoundSetupResult, { status: 'selected' }>): boolean {
  const prepared = result.round;
  if (!prepared || prepared.boardId !== state.puzzle.id || !validateGameState({
    board: state.puzzle.board, robots: prepared.roundStartRobots, target: prepared.target,
  }).valid) return false;
  const target = state.puzzle.targets.find((candidate) => candidate.id === prepared.target.id);
  if (!target || !sameTarget(target, prepared.target) || state.usedTargetIds.includes(target.id) ||
    !sameRobots(prepared.roundStartRobots, state.officialRobots) || isTargetComplete(state.officialRobots, target) ||
    !Array.isArray(result.internalProof) || result.internalProof.length === 0) return false;

  // T10 verifies its own result. Recheck at this internal acceptance boundary too,
  // so a stale/corrupted result cannot reveal an unverified puzzle.
  let robots = state.officialRobots;
  for (const step of result.internalProof) {
    if (!step || !ROBOT_IDS.includes(step.robotId) || !DIRECTIONS.includes(step.direction)) return false;
    const moved = moveRobot(state.puzzle.board, robots, step.robotId, step.direction);
    if (!moved.moved) return false;
    robots = moved.robots;
  }
  return isTargetComplete(robots, target);
}

function copyDiagnostics(diagnostics: RoundSetupDiagnostics): RoundSetupDiagnostics {
  return {
    totalTargets: diagnostics.totalTargets, usedTargetCount: diagnostics.usedTargetCount,
    alreadyCompleteTargetCount: diagnostics.alreadyCompleteTargetCount, eligibleTargetCount: diagnostics.eligibleTargetCount,
    untestedTargetCount: diagnostics.untestedTargetCount, totalExpandedStates: diagnostics.totalExpandedStates,
    candidates: diagnostics.candidates.map((candidate) => {
      const base = {
        targetId: candidate.targetId,
        limits: { maxExpandedStates: candidate.limits.maxExpandedStates, maxStoredStates: candidate.limits.maxStoredStates },
        stats: {
          expandedStates: candidate.stats.expandedStates, attemptedMoves: candidate.stats.attemptedMoves,
          generatedStates: candidate.stats.generatedStates, peakStoredStates: candidate.stats.peakStoredStates,
          searchArrayBytes: candidate.stats.searchArrayBytes,
        },
      };
      return candidate.status === 'unknown' ? { ...base, status: candidate.status, reason: candidate.reason } : { ...base, status: candidate.status };
    }),
  };
}

/** Trusted controller acceptance boundary, never a player/network command. */
export function acceptRoundPreparation(
  state: MatchState, request: RoundPreparationRequest, result: RoundSetupResult,
): MatchTransitionResult {
  const rejection = preparationRejection(state);
  if (rejection) return reject(state, rejection);
  if (state.phase !== 'preparing') return reject(state, 'wrong-phase');
  try {
    if (!matchesCurrentPreparation(state, request)) return reject(state, 'stale-preparation');
  } catch {
    return reject(state, 'invalid-preparation');
  }
  if (result?.status === 'selected') {
    if (!validSelectedResult(state, result)) return reject(state, 'invalid-preparation');
    // Construct explicitly: no proof, diagnostics, or obsolete preparation fields
    // can be copied into the active round by spreading a result object.
    return {
      state: {
        phase: 'thinking', matchId: state.matchId, players: state.players, scores: state.scores,
        puzzle: state.puzzle, officialRobots: state.officialRobots,
        completedRounds: state.completedRounds, usedTargetIds: [...state.usedTargetIds, result.round.target.id],
        round: {
          number: (state.completedRounds + 1) as RoundNumber,
          target: copyTarget(result.round.target), startRobots: copyRobots(state.officialRobots),
        },
      },
      outcome: { status: 'accepted' },
    };
  }
  if (result?.status === 'deferred' || result?.status === 'unavailable') {
    const diagnostics = copyDiagnostics(result.diagnostics);
    const preparation: PreparationStatus = result.status === 'deferred'
      ? { status: 'deferred', reason: result.reason, diagnostics }
      : { status: 'unavailable', reason: result.reason, diagnostics };
    return {
      state: { ...state, preparation },
      outcome: { status: 'accepted' },
    };
  }
  return reject(state, 'invalid-preparation');
}

/** Internal seam for focused tests. Public calls always use the real T10 preparer. */
export function prepareMatchRoundWith(
  state: MatchState, options: RoundPreparationOptions, preparer: typeof prepareNextRound,
): MatchTransitionResult {
  const rejection = preparationRejection(state);
  if (rejection) return reject(state, rejection);
  if (state.phase !== 'preparing') return reject(state, 'wrong-phase');
  const request = snapshotRoundPreparation(state, options);
  const result = preparer(request.setup);
  return acceptRoundPreparation(state, request, result);
}

/** Explicit single attempt; no clock, shuffle, background job, or automatic retry. */
export function prepareMatchRound(state: MatchState, options: RoundPreparationOptions): MatchTransitionResult {
  return prepareMatchRoundWith(state, options, prepareNextRound);
}
