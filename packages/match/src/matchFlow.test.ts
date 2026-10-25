import { expect, test } from 'vitest';
import { DIRECTIONS, ROBOT_IDS, isTargetComplete, moveRobot, validateGameState, type RobotId } from '@robot-puzzle/game-engine';
import { starterBoard } from '@robot-puzzle/puzzles';
import { prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import * as match from './index';
import type {
  DemonstratingMatchState, MatchAction, MatchPlayer, MatchState, PlayerMatchCommand,
  PreparingMatchState, RoundPreparationRequest,
} from './index';
import { snapshotRoundPreparation } from './preparation';

const roster: readonly MatchPlayer[] = ['Maria', 'Alex', 'Teo', 'Iris', 'Nikos', 'Eva']
  .map((nickname) => ({ seatId: nickname.toLowerCase(), nickname }));
const options = {
  candidateOrder: starterBoard.targets.map((target) => target.id),
  budget: RECOMMENDED_ROUND_SETUP_BUDGET,
};
const vortexId = starterBoard.targets.find((target) => target.kind === 'wildcard')!.id;
type Selected = Extract<ReturnType<typeof prepareNextRound>, { status: 'selected' }>;

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Test-only controller: no clocks, randomness, UI, or automatic recovery policy. */
class ScriptedMatch {
  state: MatchState;
  nowMs = 1_000;
  preparations = 0;
  readonly trace: { action: MatchAction; result: match.MatchTransitionResult }[] = [];
  private readonly lockedPuzzle;
  private readonly lockedPlayers;
  private previousPreparation?: { request: RoundPreparationRequest; result: Selected };

  constructor(players = roster) {
    this.state = freeze(match.createMatch({ matchId: 'scripted-match', players, puzzle: starterBoard }));
    this.lockedPuzzle = this.state.puzzle;
    this.lockedPlayers = this.state.players;
    this.invariants();
  }

  private invariants() {
    const state = this.state;
    expect(state.puzzle).toBe(this.lockedPuzzle);
    expect(state.players).toBe(this.lockedPlayers);
    expect(Object.keys(state.scores).sort()).toEqual(state.players.map((player) => player.seatId).sort());
    expect(Object.values(state.scores).every((score) => Number.isInteger(score) && score >= 0)).toBe(true);
    expect(Object.values(state.scores).reduce((sum, score) => sum + score, 0)).toBeLessThanOrEqual(state.completedRounds);
    expect(new Set(state.usedTargetIds).size).toBe(state.usedTargetIds.length);
    const active = state.phase === 'thinking' || state.phase === 'bidding' || state.phase === 'demonstrating';
    expect(state.usedTargetIds).toHaveLength(state.completedRounds + (active ? 1 : 0));
    expect(validateGameState({ board: state.puzzle.board, robots: state.officialRobots, target: state.puzzle.targets[0] }).valid).toBe(true);
    expect(state).not.toHaveProperty('internalProof');
    const fields: Record<MatchState['phase'], readonly string[]> = {
      preparing: ['preparation'], thinking: ['round'], bidding: ['round', 'bids', 'deadlineAtMs'],
      demonstrating: ['round', 'bidderQueue', 'activeBidderIndex', 'attempt'],
      'round-result': ['round', 'outcome'], finished: [],
    };
    for (const field of ['preparation', 'round', 'bids', 'deadlineAtMs', 'bidderQueue', 'activeBidderIndex', 'attempt', 'outcome']) {
      expect(Object.hasOwn(state, field)).toBe(fields[state.phase].includes(field));
    }
    if ('round' in state) {
      expect(state.round.number).toBe(state.completedRounds + (active ? 1 : 0));
      expect(state.usedTargetIds.at(-1)).toBe(state.round.target.id);
      if (active) expect(state.round.startRobots).toEqual(state.officialRobots);
    }
    if (state.phase === 'demonstrating') {
      expect(state.attempt.roundStartRobots).toEqual(state.round.startRobots);
      expect(state.attempt.moves.length).toBeLessThanOrEqual(state.bidderQueue[state.activeBidderIndex].value);
      expect(validateGameState({ board: state.puzzle.board, robots: state.attempt.robots, target: state.round.target }).valid).toBe(true);
    }
  }

  apply(action: MatchAction, expectedStatus: 'accepted' | 'no-op' | 'rejected' = 'accepted', reason?: string) {
    const before = this.state;
    const original = JSON.stringify(before);
    const result = match.transitionMatch(before, freeze(action));
    expect(JSON.stringify(before)).toBe(original);
    expect(result.outcome.status).toBe(expectedStatus);
    if (reason) expect(result.outcome).toMatchObject({ reason });
    const success = result.state.phase === 'round-result' && result.state.outcome.kind === 'success' && before.phase !== 'round-result';
    const completion = result.state.phase === 'round-result' && before.phase !== 'round-result';
    const reveal = before.phase === 'preparing' && result.state.phase === 'thinking';
    expect(result.state.completedRounds).toBe(before.completedRounds + (completion ? 1 : 0));
    if (success && result.state.phase === 'round-result' && result.state.outcome.kind === 'success') {
      const winner = result.state.outcome.winnerSeatId;
      expect(result.state.scores).toEqual({ ...before.scores, [winner]: before.scores[winner] + 1 });
      expect(before.phase).toBe('demonstrating');
      if (before.phase === 'demonstrating' && action.source === 'player' && action.command.type === 'attempt.move') {
        expect(result.state.officialRobots).toEqual(moveRobot(before.puzzle.board, before.attempt.robots, action.command.robotId, action.command.direction).robots);
      }
    } else {
      expect(result.state.scores).toBe(before.scores);
      expect(result.state.officialRobots).toBe(before.officialRobots);
    }
    if (!reveal) expect(result.state.usedTargetIds).toBe(before.usedTargetIds);
    this.state = freeze(result.state);
    this.invariants();
    this.trace.push({ action, result });
    return result;
  }

  player(command: PlayerMatchCommand, actorSeatId = 'maria', status: 'accepted' | 'no-op' | 'rejected' = 'accepted', reason?: string) {
    return this.apply({ source: 'player', command, context: { actorSeatId, hostSeatId: 'maria', nowMs: this.nowMs } }, status, reason);
  }

  tick(status: 'accepted' | 'no-op' = 'no-op', reason?: string) {
    return this.apply({ source: 'controller', command: { type: 'time.advance' }, context: { nowMs: this.nowMs } }, status, reason);
  }

  demo(): DemonstratingMatchState {
    if (this.state.phase !== 'demonstrating') throw new Error('Expected demonstration.');
    return this.state;
  }

  prepare(targetId?: string, failures = false): Selected {
    if (this.state.phase !== 'preparing') throw new Error('Expected preparation.');
    const state: PreparingMatchState = this.state;
    // Replaying an older result must fail even if a skipped round left robots unchanged.
    if (this.previousPreparation) this.apply({ source: 'controller', command: { type: 'round.prepared', ...this.previousPreparation }, context: { nowMs: this.nowMs } }, 'rejected', 'stale-preparation');
    const config = targetId ? { ...options, candidateOrder: [targetId, ...options.candidateOrder.filter((id) => id !== targetId)] } : options;
    if (failures) {
      const request = snapshotRoundPreparation(state, { ...config, budget: { ...config.budget, maxTotalExpandedStates: 0 } });
      const deferred = prepareNextRound(request.setup);
      this.preparations++;
      expect(deferred.status).toBe('deferred');
      this.apply({ source: 'controller', command: { type: 'round.prepared', request, result: deferred }, context: { nowMs: this.nowMs } });
      // A controlled trusted failure isolates unavailable-state handling; no false solvability claim.
      this.apply({ source: 'controller', command: {
        type: 'round.prepared', request,
        result: { status: 'unavailable', reason: 'all-eligible-targets-unsolvable', diagnostics: deferred.diagnostics },
      }, context: { nowMs: this.nowMs } });
      expect(this.state.phase).toBe('preparing');
      expect(this.state.completedRounds).toBe(state.completedRounds);
    }
    const request = snapshotRoundPreparation(state, config);
    const result = prepareNextRound(request.setup);
    this.preparations++;
    if (result.status !== 'selected') throw new Error(`Fixture selection failed: ${result.status}/${result.reason}`);
    if (targetId) expect(result.round.target.id).toBe(targetId);
    expect(isTargetComplete(state.officialRobots, result.round.target)).toBe(false);
    this.apply({ source: 'controller', command: { type: 'round.prepared', request, result }, context: { nowMs: this.nowMs } });
    this.previousPreparation = { request, result };
    return result;
  }

  /** Find legal, non-solving detours, so failure scripts cannot accidentally win. */
  detour(exclude?: RobotId) {
    const state = this.demo();
    for (const robotId of ROBOT_IDS) for (const direction of DIRECTIONS) {
      if (robotId === exclude) continue;
      const moved = moveRobot(state.puzzle.board, state.attempt.robots, robotId, direction);
      if (moved.moved && !isTargetComplete(moved.robots, state.round.target)) return { type: 'attempt.move' as const, robotId, direction };
    }
    throw new Error('Expected a safe fixture detour.');
  }

  advance() {
    this.apply({ source: 'controller', command: { type: 'round.advance' }, context: { nowMs: this.nowMs } });
    this.apply({ source: 'controller', command: { type: 'round.advance' }, context: { nowMs: this.nowMs } }, 'rejected', this.state.phase === 'finished' ? 'match-finished' : 'wrong-phase');
    this.nowMs += 100_000;
  }
}

function exhaust(script: ScriptedMatch) {
  script.player({ type: 'bid.submit', value: 3 });
  script.player({ type: 'bid.submit', value: 5 }, 'alex');
  script.nowMs += 60_000;
  script.tick('accepted');
  script.player(script.detour());
  script.player({ type: 'attempt.giveUp' });
  expect(script.demo().attempt.moves).toEqual([]);
  script.player({ type: 'attempt.giveUp' }, 'alex');
  expect(script.state.phase === 'round-result' && script.state.outcome.kind).toBe('all-bidders-gave-up');
}

function solve(script: ScriptedMatch, proof: Selected, winner = 'maria') {
  script.player({ type: 'bid.submit', value: proof.internalProof.length + 2 }, winner);
  script.nowMs += 60_000;
  script.tick('accepted');
  for (const step of proof.internalProof) script.player({ type: 'attempt.move', ...step }, winner);
  expect(script.state.phase === 'round-result' && script.state.outcome).toMatchObject({ kind: 'success', winnerSeatId: winner });
}

function mixedMatch() {
  const script = new ScriptedMatch();
  for (let round = 1; round <= 10; round++) {
    const proof = script.prepare(round === 1 ? 'red-star' : round === 5 ? vortexId : undefined, round === 3);
    script.player({ type: 'attempt.move', robotId: 'red', direction: 'up' }, 'maria', 'rejected', 'wrong-phase');
    script.tick('no-op', 'no-active-deadline');
    if (round === 1) {
      const start = script.state.officialRobots;
      const size = proof.internalProof.length;
      script.player({ type: 'bid.submit', value: 2 });
      script.player({ type: 'bid.submit', value: size + 4 }, 'alex');
      script.player({ type: 'bid.submit', value: size + 8 }, 'teo');
      script.player({ type: 'bid.submit', value: size + 2 }, 'iris');
      script.player({ type: 'bid.submit', value: size + 9 }, 'nikos');
      script.player({ type: 'bid.submit', value: size + 2 }, 'alex');
      script.player({ type: 'bid.submit', value: size + 2 }, 'nikos');
      script.player({ type: 'bid.submit', value: size + 2 }, 'alex', 'no-op', 'same-bid');
      script.player({ type: 'bid.submit', value: size + 3 }, 'alex', 'rejected', 'bid-increase');
      script.nowMs += 59_999;
      script.tick('no-op', 'deadline-not-due');
      script.nowMs++;
      script.player({ type: 'bid.submit', value: 1 }, 'eva', 'rejected', 'bidding-closed');
      expect(script.demo().bidderQueue.map((bid) => bid.seatId)).toEqual(['maria', 'alex', 'iris', 'nikos', 'teo']);
      script.player(script.detour(), 'alex', 'rejected', 'not-active-bidder');
      script.player({ type: 'attempt.undo' }, 'maria', 'no-op', 'empty-undo');
      const first = script.detour();
      script.player(first);
      const second = script.detour(first.robotId);
      script.player(second);
      script.player(second, 'maria', 'no-op', 'blocked-move');
      script.player(script.detour(), 'maria', 'rejected', 'bid-limit');
      script.player({ type: 'attempt.undo' });
      expect(script.demo().attempt.moves).toHaveLength(1);
      script.player({ type: 'attempt.reset' });
      expect(script.demo().attempt.robots).toEqual(start);
      script.player(first);
      script.player(second);
      const progressed = script.state;
      script.tick('no-op', 'no-active-deadline');
      expect(script.state).toBe(progressed);
      script.player({ type: 'attempt.giveUp' });
      expect(script.demo().attempt.robots).toEqual(start);
      expect(script.demo().attempt.moves).toEqual([]);
      expect(script.demo().bidderQueue[script.demo().activeBidderIndex].seatId).toBe('alex');
      script.player({ type: 'attempt.giveUp' }, 'maria', 'rejected', 'not-active-bidder');
      for (const step of proof.internalProof) script.player({ type: 'attempt.move', ...step }, 'alex');
      expect(script.state.officialRobots.red).not.toEqual(start.red);
      expect(script.state.officialRobots.blue).not.toEqual(start.blue);
      expect(script.state.phase === 'round-result' && script.state.outcome).toMatchObject({ kind: 'success', winnerSeatId: 'alex', moveCount: size, winningBid: size + 2 });
    } else if ([2, 5, 8].includes(round)) {
      solve(script, proof, round === 8 ? 'alex' : 'maria');
      if (round === 5) expect(proof.round.target.kind).toBe('wildcard');
    } else if ([3, 6, 9].includes(round)) {
      script.player({ type: 'round.skip', confirmed: true });
    } else {
      exhaust(script);
    }
    expect(script.state.completedRounds).toBe(round);
    script.player({ type: 'attempt.giveUp' }, 'maria', 'rejected', 'wrong-phase');
    script.player({ type: 'round.skip', confirmed: true }, 'maria', 'rejected', 'wrong-phase');
    script.advance();
  }
  expect(script.state.phase).toBe('finished');
  if (script.state.phase !== 'finished') throw new Error('Expected finished match.');
  expect(script.state.scores).toEqual({ maria: 2, alex: 2, teo: 0, iris: 0, nikos: 0, eva: 0 });
  expect(match.getMatchResults(script.state).winnerSeatIds).toEqual(['maria', 'alex']);
  expect(script.preparations).toBe(11); // Ten selected targets, one explicit zero-budget deferral.
  script.player({ type: 'bid.submit', value: 1 }, 'maria', 'rejected', 'match-finished');
  const afterFinish = match.prepareMatchRound(script.state, options);
  expect(afterFinish).toEqual({ state: script.state, outcome: { status: 'rejected', reason: 'match-finished' } });
  return script;
}

test('six-player mixed ten-round match is immutable and replayable through real T10, corrections, rollback, and shared victory', () => {
  const first = mixedMatch();
  const second = mixedMatch();
  expect(second.state).toEqual(first.state);
  expect(second.trace).toEqual(first.trace);
});

test('two-player ten-round no-point match preserves every robot and ends in an all-zero shared win', () => {
  const script = new ScriptedMatch(roster.slice(0, 2));
  const initialRobots = script.state.officialRobots;
  for (let round = 1; round <= 10; round++) {
    script.prepare();
    if (round % 2 === 1) script.player({ type: 'round.skip', confirmed: true });
    else exhaust(script);
    expect(script.state.officialRobots).toBe(initialRobots);
    expect(script.state.scores).toEqual({ maria: 0, alex: 0 });
    script.advance();
  }
  expect(script.preparations).toBe(10);
  if (script.state.phase !== 'finished') throw new Error('Expected finished match.');
  expect(match.getMatchResults(script.state).winnerSeatIds).toEqual(['maria', 'alex']);
  expect(script.state.usedTargetIds).toHaveLength(10);
});

test('public runtime exports contain only implemented API and no preparation internals or solution helpers', () => {
  expect(Object.keys(match).sort()).toEqual([
    'BIDDING_WINDOW_MS', 'MATCH_PHASES', 'MATCH_ROUND_COUNT',
    'createMatch', 'getMatchResults', 'prepareMatchRound', 'transitionMatch',
  ].sort());
});
