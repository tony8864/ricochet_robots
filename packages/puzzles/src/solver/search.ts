import {
  assertValidGameState,
  DIRECTIONS,
  ROBOT_IDS,
  type Board,
  type GameState,
} from '@robot-puzzle/game-engine';
import { cellIndex, encodeRobots, robotCell } from './state';
import { MAX_STORED_STATES, type SolverLimits, type SolverMove, type SolverResult } from './types';

/** Internal seam for comparing indexed movement against the engine baseline. */
export type TransitionFactory = (board: Board) => (
  state: number, robotIndex: number, directionIndex: number,
) => number;

function validateLimits(limits: SolverLimits): void {
  if (
    !limits || !Number.isSafeInteger(limits.maxExpandedStates) ||
    limits.maxExpandedStates < 0 || !Number.isSafeInteger(limits.maxStoredStates) ||
    limits.maxStoredStates < 1 || limits.maxStoredStates > MAX_STORED_STATES
  ) {
    throw new RangeError(
      `Invalid solver limits: maxExpandedStates must be a nonnegative safe integer; ` +
      `maxStoredStates must be an integer from 1 to ${MAX_STORED_STATES}.`,
    );
  }
}

/** Breadth-first search: each unique state is enqueued and expanded at most once. */
export function searchPuzzle(
  input: GameState,
  limits: SolverLimits,
  createTransition: TransitionFactory,
): SolverResult {
  assertValidGameState(input);
  validateLimits(limits);
  const start = encodeRobots(input.robots);
  const targetCell = cellIndex(input.target.position);
  const targetRobot = input.target.kind === 'colored' ? ROBOT_IDS.indexOf(input.target.robotId) : -1;
  const complete = (state: number): boolean => targetRobot === -1
    ? ROBOT_IDS.some((_, index) => robotCell(state, index) === targetCell)
    : robotCell(state, targetRobot) === targetCell;
  const stats = {
    expandedStates: 0, attemptedMoves: 0, generatedStates: 0,
    peakStoredStates: 1, searchArrayBytes: 0,
  };
  if (complete(start)) return { status: 'solved', moves: [], stats };
  if (limits.maxExpandedStates === 0) return { status: 'unknown', reason: 'expansion-limit', stats };

  // Fixed-size arrays bound queue/path storage. The visited Set has at most
  // maxStoredStates entries. No complete paths or decoded states are retained.
  const states = new Uint32Array(limits.maxStoredStates);
  const parents = new Uint32Array(limits.maxStoredStates);
  const moves = new Uint8Array(limits.maxStoredStates);
  stats.searchArrayBytes = states.byteLength + parents.byteLength + moves.byteLength;
  states[0] = start;
  const visited = new Set<number>([start]);
  const transition = createTransition(input.board);
  let stored = 1;

  function solution(parent: number, finalMove: number): SolverMove[] {
    const codes = [finalMove];
    while (parent !== 0) {
      codes.push(moves[parent]);
      parent = parents[parent];
    }
    return codes.reverse().map((code) => ({
      robotId: ROBOT_IDS[code >>> 2], direction: DIRECTIONS[code & 3],
    }));
  }

  for (let head = 0; head < stored; head++) {
    if (stats.expandedStates === limits.maxExpandedStates) {
      return { status: 'unknown', reason: 'expansion-limit', stats };
    }
    stats.expandedStates++;
    const state = states[head];
    for (let robot = 0; robot < 4; robot++) {
      for (let direction = 0; direction < 4; direction++) {
        stats.attemptedMoves++;
        const next = transition(state, robot, direction);
        if (next === state) continue;
        stats.generatedStates++;
        if (visited.has(next)) continue;
        const move = robot * 4 + direction;
        // A witness can be returned without retaining the final state.
        if (complete(next)) return { status: 'solved', moves: solution(head, move), stats };
        if (stored === limits.maxStoredStates) {
          return { status: 'unknown', reason: 'storage-limit', stats };
        }
        visited.add(next);
        states[stored] = next;
        parents[stored] = head;
        moves[stored] = move;
        stats.peakStoredStates = ++stored;
      }
    }
  }
  // Only queue exhaustion proves impossibility. Neither budget exit does.
  return { status: 'unsolvable', stats };
}
