import { expect, expectTypeOf, test } from 'vitest';
import { ROBOT_IDS, moveAttemptRobot, type RobotId } from '@robot-puzzle/game-engine';
import { starterBoard, type PuzzleBoard } from '@robot-puzzle/puzzles';
import { prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import {
  createMatch, prepareMatchRound, transitionMatch,
  type AttemptMatchCommand, type BiddingMatchState, type DemonstratingMatchState, type DemonstrationStageAction,
  type MatchAction, type MatchState, type RoundResultMatchState, type ThinkingMatchState,
} from './index';

const players = [{ seatId: 'maria', nickname: 'Maria' }, { seatId: 'alex', nickname: 'Alex' }, { seatId: 'teo', nickname: 'Teo' }];

test('trusted abandonment shares Give Up rollback/queue and exhausted-round behavior, not player authority', () => {
  const start = thinking();
  let state = transitionMatch(openBidding(start), { source: 'controller', command: { type: 'time.advance' }, context: { nowMs: 100000 } }).state;
  while (state.phase === 'demonstrating') {
    const original = structuredClone(state);
    const bidder = state.bidderQueue[state.activeBidderIndex].seatId;
    const giveUp = transitionMatch(state, { source: 'player', context: { actorSeatId: bidder, hostSeatId: 'maria', nowMs: 100000 }, command: { type: 'attempt.giveUp' } });
    const abandoned = transitionMatch(state, { source: 'controller', context: { nowMs: 100000 }, command: { type: 'attempt.abandon' } });
    expect(abandoned).toEqual(giveUp); expect(state).toEqual(original);
    expect(abandoned.state.officialRobots).toEqual(start.officialRobots); expect(abandoned.state.scores).toEqual(start.scores);
    state = abandoned.state;
  }
  expect(state.phase).toBe('round-result');
  expect(transitionMatch(start, { source: 'controller', context: { nowMs: 100000 }, command: { type: 'attempt.abandon' } }).outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
  expect(transitionMatch(start, { source: 'player', context: { actorSeatId: 'maria', hostSeatId: 'maria', nowMs: 100000 }, command: { type: 'attempt.abandon' } } as unknown as MatchAction).outcome).toEqual({ status: 'rejected', reason: 'invalid-command' });
});

function thinking(puzzle = starterBoard, targetId = 'blue-star'): ThinkingMatchState {
  const initial = createMatch({ matchId: 'match-1', players, puzzle });
  const prepared = prepareMatchRound(initial, {
    candidateOrder: [targetId, ...puzzle.targets.map((target) => target.id).filter((id) => id !== targetId)],
    budget: RECOMMENDED_ROUND_SETUP_BUDGET,
  });
  if (prepared.state.phase !== 'thinking') throw new Error('Expected a verified test round.');
  expect(prepared.state.round.target.id).toBe(targetId);
  return prepared.state;
}

function openBidding(start: ThinkingMatchState, bids = [3, 4]): BiddingMatchState {
  let state: MatchState = start;
  for (let index = 0; index < bids.length; index++) {
    state = transitionMatch(state, {
      source: 'player', command: { type: 'bid.submit', value: bids[index] },
      context: { actorSeatId: players[index].seatId, hostSeatId: 'maria', nowMs: 1000 },
    }).state;
  }
  if (state.phase !== 'bidding') throw new Error('Expected open bidding.');
  return state;
}

function demo(state: MatchState): DemonstratingMatchState {
  expect(state.phase).toBe('demonstrating');
  if (state.phase !== 'demonstrating') throw new Error('Expected demonstration.');
  return state;
}

function result(state: MatchState): RoundResultMatchState {
  expect(state.phase).toBe('round-result');
  if (state.phase !== 'round-result') throw new Error('Expected a resolved round.');
  return state;
}

function start(bids = [3, 4], puzzle = starterBoard, targetId = 'blue-star'): DemonstratingMatchState {
  const open = openBidding(thinking(puzzle, targetId), bids);
  return demo(transitionMatch(open, { source: 'controller', command: { type: 'time.advance' }, context: { nowMs: open.deadlineAtMs } }).state);
}

function act(state: MatchState, command: AttemptMatchCommand, actorSeatId = 'maria', nowMs = 62_000) {
  return transitionMatch(state, { source: 'player', command, context: { actorSeatId, hostSeatId: 'maria', nowMs } });
}

function move(state: MatchState, robotId: RobotId, direction: 'up' | 'right' | 'down' | 'left', actor = 'maria') {
  return act(state, { type: 'attempt.move', robotId, direction }, actor);
}

const commands: readonly AttemptMatchCommand[] = [
  { type: 'attempt.move', robotId: 'red', direction: 'right' },
  { type: 'attempt.undo' }, { type: 'attempt.reset' }, { type: 'attempt.giveUp' },
];

test('legal slides update only the provisional attempt and engine history', () => {
  const state = start();
  const changed = move(state, 'blue', 'down');
  expect(changed.outcome.status).toBe('accepted');
  const next = demo(changed.state);
  expect(next.attempt.robots.blue).toEqual({ row: 14, column: 15 });
  expect(next.attempt.moves).toHaveLength(1);
  expect(next.officialRobots).toEqual(state.officialRobots);
  expect(next.round.startRobots).toEqual(state.round.startRobots);
  expect(next.scores).toEqual(state.scores);
  expect(next.completedRounds).toBe(0);
});

test.each(commands)('only the active bidder can issue %j, including when the host is inactive', (command) => {
  const state = start([4, 3]); // Alex has the lower bid; Maria is host but not active.
  const denied = act(state, command);
  expect(denied.outcome).toEqual({ status: 'rejected', reason: 'not-active-bidder' });
  expect(denied.state).toBe(state);
  const nonbidder = act(state, command, 'teo');
  expect(nonbidder.outcome).toEqual({ status: 'rejected', reason: 'not-active-bidder' });
  expect(nonbidder.state).toBe(state);
});

test('thinking/bidding cannot simulate moves or give up, and wrong phases preserve state', () => {
  const ready = thinking();
  const open = openBidding(ready);
  const initial = createMatch({ matchId: 'new', players, puzzle: starterBoard });
  for (const state of [initial, ready, open]) {
    for (const command of commands) {
      const denied = act(state, command, 'maria', 2000);
      expect(denied.outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
      expect(denied.state).toBe(state);
    }
  }
});

test('blocked moves and empty corrections are no-ops', () => {
  const state = start();
  expect(move(state, 'red', 'up')).toEqual({ state, outcome: { status: 'no-op', reason: 'blocked-move' } });
  expect(act(state, { type: 'attempt.undo' })).toEqual({ state, outcome: { status: 'no-op', reason: 'empty-undo' } });
  expect(act(state, { type: 'attempt.reset' })).toEqual({ state, outcome: { status: 'no-op', reason: 'already-reset' } });
});

test('at the bid limit, no-ops remain free and an extra solving move is rejected without failure', () => {
  const initial = start([1, 3]);
  const limit = demo(move(initial, 'blue', 'down').state);
  expect(limit.attempt.moves).toHaveLength(1);
  const blocked = move(limit, 'blue', 'down');
  expect(blocked.outcome).toEqual({ status: 'no-op', reason: 'blocked-move' });
  expect(blocked.state).toBe(limit);
  const over = move(limit, 'blue', 'left');
  expect(over.outcome).toEqual({ status: 'rejected', reason: 'bid-limit' });
  expect(over.state).toBe(limit);
  expect(limit.scores).toEqual(initial.scores);
  const undone = demo(act(limit, { type: 'attempt.undo' }).state);
  expect(undone.attempt.moves).toEqual([]);
  expect(undone.attempt.robots).toEqual(initial.round.startRobots);
  const reset = demo(act(limit, { type: 'attempt.reset' }).state);
  expect(reset.attempt.moves).toEqual([]);
  expect(reset.activeBidderIndex).toBe(0);
});

test.each([2, 5])('success within a bid of %i awards once and atomically resolves the round', (bid) => {
  const initial = start([bid]);
  const down = demo(move(initial, 'blue', 'down').state);
  const finished = result(move(down, 'blue', 'left').state);
  expect(finished.outcome).toEqual({ kind: 'success', winnerSeatId: 'maria', winningBid: bid, moveCount: 2 });
  expect(finished.scores).toEqual({ maria: 1, alex: 0, teo: 0 });
  expect(finished.officialRobots.blue).toEqual({ row: 14, column: 11 });
  expect(finished.round.startRobots).toEqual(initial.officialRobots);
  expect(finished.officialRobots).not.toEqual(finished.round.startRobots);
  expect(finished.completedRounds).toBe(1);
  expect(finished.usedTargetIds).toEqual(initial.usedTargetIds);
  for (const field of ['attempt', 'bidderQueue', 'activeBidderIndex', 'deadlineAtMs', 'bids']) expect(finished).not.toHaveProperty(field);
});

test('undo and reset discard moves freely; only the retained sequence counts toward success', () => {
  const initial = start([3]);
  let state = demo(move(initial, 'blue', 'down').state);
  state = demo(move(state, 'red', 'right').state);
  const undone = demo(act(state, { type: 'attempt.undo' }).state);
  expect(undone.attempt.moves).toHaveLength(1);
  expect(undone.attempt.robots.red).toEqual(initial.round.startRobots.red);
  expect(result(move(undone, 'blue', 'left').state).outcome).toMatchObject({ moveCount: 2 });
  const reset = demo(act(state, { type: 'attempt.reset' }).state);
  expect(reset.attempt.robots).toEqual(initial.round.startRobots);
  expect(reset.attempt.moves).toEqual([]);
  const down = demo(move(reset, 'blue', 'down').state);
  expect(result(move(down, 'blue', 'left').state).outcome).toMatchObject({ moveCount: 2 });
});

test('a helper-robot proof commits the complete four-robot state, not only the target robot', () => {
  const targetId = 'red-star';
  const proof = prepareNextRound({
    puzzle: starterBoard, robots: starterBoard.initialRobots, usedTargetIds: [],
    candidateOrder: starterBoard.targets.map((target) => target.id), budget: RECOMMENDED_ROUND_SETUP_BUDGET,
  });
  if (proof.status !== 'selected') throw new Error('Expected a known helper-robot solution.');
  const initial = start([proof.internalProof.length], starterBoard, targetId);
  let state: MatchState = initial;
  let expected = initial.attempt;
  for (const step of proof.internalProof) {
    expected = moveAttemptRobot(initial.puzzle.board, expected, step.robotId, step.direction).attempt;
    const transition = move(state, step.robotId, step.direction);
    expect(transition.outcome.status).toBe('accepted');
    state = transition.state;
  }
  const finished = result(state);
  expect(finished.officialRobots.red).not.toEqual(initial.officialRobots.red);
  expect(finished.officialRobots.blue).not.toEqual(initial.officialRobots.blue);
  for (const id of ROBOT_IDS) {
    expect(finished.officialRobots[id]).toEqual(expected.robots[id]);
    expect(finished.officialRobots[id]).not.toBe(expected.robots[id]);
  }
  expect(finished.round.startRobots).toEqual(initial.officialRobots);
});

test.each(ROBOT_IDS)('a vortex can be completed by %s', (robotId) => {
  const puzzle = { ...starterBoard, initialRobots: { ...starterBoard.initialRobots, [robotId]: { row: 11, column: 13 } } };
  const initial = start([1], puzzle, 'wildcard-vortex');
  const finished = result(move(initial, robotId, 'right').state);
  expect(finished.outcome).toMatchObject({ kind: 'success', moveCount: 1 });
  expect(finished.officialRobots[robotId]).toEqual(initial.round.target.position);
});

test('the wrong robot on a colored target does not resolve the round', () => {
  const puzzle = { ...starterBoard, initialRobots: { ...starterBoard.initialRobots, red: starterBoard.initialRobots.blue, blue: starterBoard.initialRobots.red } };
  const initial = start([4], puzzle);
  const down = demo(move(initial, 'red', 'down').state);
  const landed = demo(move(down, 'red', 'left').state);
  expect(landed.attempt.robots.red).toEqual(initial.round.target.position);
  expect(landed.scores).toEqual(initial.scores);
  expect(landed.completedRounds).toBe(0);
});

test('give-up rolls back every moved robot, clears history, and uses the next bidder’s own limit', () => {
  const initial = start([3, 4]);
  let state = demo(move(initial, 'blue', 'down').state);
  state = demo(move(state, 'red', 'right').state);
  state = demo(move(state, 'green', 'up').state);
  const next = demo(act(state, { type: 'attempt.giveUp' }).state);
  expect(next.activeBidderIndex).toBe(1);
  expect(next.bidderQueue[1]).toMatchObject({ seatId: 'alex', value: 4 });
  expect(next.attempt.robots).toEqual(initial.round.startRobots);
  expect(next.attempt.moves).toEqual([]);
  expect(next.officialRobots).toEqual(initial.officialRobots);
  expect(next.scores).toEqual(initial.scores);
  expect(next.bidderQueue).toEqual(initial.bidderQueue);
  expect(next.completedRounds).toBe(0);
  expect(act(next, { type: 'attempt.giveUp' }).outcome).toEqual({ status: 'rejected', reason: 'not-active-bidder' });
  let alex = demo(move(next, 'blue', 'down', 'alex').state);
  alex = demo(move(alex, 'red', 'right', 'alex').state);
  alex = demo(move(alex, 'green', 'up', 'alex').state);
  alex = demo(move(alex, 'red', 'left', 'alex').state);
  expect(alex.attempt.moves).toHaveLength(4);
  expect(move(alex, 'red', 'down', 'alex').outcome).toEqual({ status: 'rejected', reason: 'bid-limit' });
  const failed = result(act(alex, { type: 'attempt.giveUp' }, 'alex').state);
  expect(failed.outcome).toEqual({ kind: 'all-bidders-gave-up' });
  expect(failed.scores).toEqual(initial.scores);
  expect(failed.officialRobots).toEqual(initial.officialRobots);
  expect(failed.completedRounds).toBe(1);
  expect(failed.usedTargetIds).toEqual(initial.usedTargetIds);
});

test('a later bidder can succeed after the first gives up, awarding only the successful seat', () => {
  const initial = start([1, 3]);
  const wrong = demo(move(initial, 'red', 'right').state);
  const next = demo(act(wrong, { type: 'attempt.giveUp' }).state);
  const down = demo(move(next, 'blue', 'down', 'alex').state);
  const finished = result(move(down, 'blue', 'left', 'alex').state);
  expect(finished.scores).toEqual({ maria: 0, alex: 1, teo: 0 });
  expect(finished.officialRobots.red).toEqual(initial.officialRobots.red);
  expect(finished.outcome).toMatchObject({ winnerSeatId: 'alex', winningBid: 3, moveCount: 2 });
});

test.each(['success', 'give-up'])('stale/repeated attempt commands after %s cannot change the resolved round', (kind) => {
  const initial = start([3]);
  const finished = kind === 'give-up'
    ? result(act(initial, { type: 'attempt.giveUp' }).state)
    : result(move(move(initial, 'blue', 'down').state, 'blue', 'left').state);
  for (const command of commands) {
    const repeated = act(finished, command);
    expect(repeated.outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
    expect(repeated.state).toBe(finished);
  }
  expect(transitionMatch(finished, { source: 'controller', command: { type: 'time.advance' }, context: { nowMs: Number.MAX_SAFE_INTEGER } }).state).toBe(finished);
  expect(finished.completedRounds).toBe(1);
});

test('success after an earlier resolved round preserves prior scores/positions and increments exactly once', () => {
  const first = start([10], starterBoard, 'red-star');
  const proof = prepareNextRound({
    puzzle: first.puzzle, robots: first.officialRobots, usedTargetIds: [],
    candidateOrder: starterBoard.targets.map((target) => target.id), budget: RECOMMENDED_ROUND_SETUP_BUDGET,
  });
  if (proof.status !== 'selected') throw new Error('Expected verified helper solution.');
  const resolved = result(proof.internalProof.reduce<MatchState>((state, step) => move(state, step.robotId, step.direction).state, first));
  expect(resolved.completedRounds).toBe(1);
  const advanced = transitionMatch(resolved, { source: 'controller', command: { type: 'round.advance' }, context: { nowMs: 62_000 } });
  const prepared = prepareMatchRound(advanced.state, {
    candidateOrder: ['blue-star', ...starterBoard.targets.map((target) => target.id).filter((id) => id !== 'blue-star')],
    budget: RECOMMENDED_ROUND_SETUP_BUDGET,
  });
  if (prepared.state.phase !== 'thinking') throw new Error('Expected next verified round.');
  const open = openBidding(prepared.state);
  const next = demo(transitionMatch(open, { source: 'controller', command: { type: 'time.advance' }, context: { nowMs: open.deadlineAtMs } }).state);
  const finished = result(move(next, 'blue', 'down').state);
  expect(finished.scores).toEqual({ maria: 2, alex: 0, teo: 0 });
  expect(finished.completedRounds).toBe(2);
  expect(finished.usedTargetIds).toEqual(['red-star', 'blue-star']);
  expect(finished.round.startRobots).toEqual(resolved.officialRobots);
  expect(finished.officialRobots.red).toEqual(resolved.officialRobots.red);
});

test('valid actions at the deadline normalize expiry before active-bidder permissions', () => {
  const open = openBidding(thinking());
  const accepted = act(open, { type: 'attempt.move', robotId: 'blue', direction: 'down' }, 'maria', open.deadlineAtMs);
  expect(accepted.outcome.status).toBe('accepted');
  expect(demo(accepted.state).attempt.moves).toHaveLength(1);
  const denied = act(open, { type: 'attempt.giveUp' }, 'alex', open.deadlineAtMs);
  expect(denied.outcome).toEqual({ status: 'rejected', reason: 'not-active-bidder' });
  expect(demo(denied.state).attempt.moves).toEqual([]);
  const unknown = act(open, { type: 'attempt.undo' }, 'ghost', open.deadlineAtMs);
  expect(unknown.outcome).toEqual({ status: 'rejected', reason: 'unknown-player' });
  demo(unknown.state);
});

test.each([
  { type: 'attempt.move', robotId: 'black', direction: 'up' },
  { type: 'attempt.move', robotId: 'red', direction: 'diagonal' },
  { type: 'attempt.move', robotId: 'red' },
])('invalid movement payload %j cannot move, resolve, or skip the bidder', (command) => {
  const state = start();
  const malformed = { source: 'player', command, context: { actorSeatId: 'maria', hostSeatId: 'maria', nowMs: 62_000 } } as unknown as DemonstrationStageAction;
  const denied = transitionMatch(state, malformed);
  expect(denied.outcome).toEqual({ status: 'rejected', reason: 'invalid-command' });
  expect(denied.state).toBe(state);
});

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test('frozen inputs and deterministic replay preserve official/round-start snapshots through correction and success', () => {
  const initial = freeze(start([3]));
  const before = JSON.stringify(initial);
  const steps: readonly AttemptMatchCommand[] = [
    { type: 'attempt.move', robotId: 'blue', direction: 'down' },
    { type: 'attempt.move', robotId: 'red', direction: 'right' },
    { type: 'attempt.undo' }, { type: 'attempt.reset' },
    { type: 'attempt.move', robotId: 'blue', direction: 'down' },
    { type: 'attempt.move', robotId: 'blue', direction: 'left' },
  ];
  const replay = () => steps.reduce<MatchState>((state, command) => act(freeze(state), freeze(command)).state, initial);
  const finished = result(replay());
  expect(replay()).toEqual(finished);
  expect(JSON.stringify(initial)).toBe(before);
  expect(finished.round.startRobots).toEqual(initial.round.startRobots);
  expect(finished.outcome).toMatchObject({ moveCount: 2 });
});

test('give-up on frozen state is deterministic and leaves the failed history/official positions untouched', () => {
  const initial = start();
  const moved = demo(move(move(initial, 'blue', 'down').state, 'red', 'right').state);
  const state = freeze(moved);
  const before = JSON.stringify(state);
  const next = act(state, { type: 'attempt.giveUp' });
  expect(act(state, { type: 'attempt.giveUp' })).toEqual(next);
  expect(JSON.stringify(state)).toBe(before);
  expect(demo(next.state).attempt.robots).toEqual(initial.round.startRobots);
  expect(state.attempt.moves).toHaveLength(2);
});

test('the historical attempt subset is supported by the full lifecycle API', () => {
  expectTypeOf<Parameters<typeof transitionMatch>[1]>().toEqualTypeOf<MatchAction>();
  expectTypeOf<DemonstrationStageAction>().toExtend<MatchAction>();
  expectTypeOf<MatchAction>().not.toExtend<DemonstrationStageAction>();
});
