import { expect, expectTypeOf, test } from 'vitest';
import type { AttemptState, RobotPositions } from '@robot-puzzle/game-engine';
import type { RoundSetupResult } from '@robot-puzzle/puzzles/round-setup';
import * as entry from './index';
import type {
  BiddingMatchState, DemonstratingMatchState, FinishedMatchState, MatchAction,
  MatchBid, MatchState, MatchTransitionResult, PreparationStatus, RoundNumber,
  RoundOutcome, ThinkingMatchState,
} from './index';

test('public entry exposes agreed rules and implemented creation/preparation functions', () => {
  expect(entry.MATCH_PHASES).toEqual(['preparing', 'thinking', 'bidding', 'demonstrating', 'round-result', 'finished']);
  expect(entry.MATCH_ROUND_COUNT).toBe(10);
  expect(entry.BIDDING_WINDOW_MS).toBe(60_000);
  expect(entry.createMatch).toBeTypeOf('function');
  expect(entry.prepareMatchRound).toBeTypeOf('function');
});

test('phase narrowing makes the correct data available', () => {
  expectTypeOf<Extract<MatchState, { phase: 'bidding' }>>().toEqualTypeOf<BiddingMatchState>();
  expectTypeOf<Extract<MatchState, { phase: 'demonstrating' }>['attempt']>().toEqualTypeOf<AttemptState>();
  expectTypeOf<Extract<MatchState, { phase: 'thinking' }>>().toEqualTypeOf<ThinkingMatchState>();
  expectTypeOf<DemonstratingMatchState['bidderQueue'][0]>().toEqualTypeOf<MatchBid>();
  expectTypeOf<MatchState['officialRobots']>().toEqualTypeOf<RobotPositions>();
});

test('bidding and demonstrations require nonempty bids, with deadlines only in bidding', () => {
  expectTypeOf<[]>().not.toExtend<BiddingMatchState['bids']>();
  expectTypeOf<[]>().not.toExtend<DemonstratingMatchState['bidderQueue']>();
  expectTypeOf<keyof ThinkingMatchState>().exclude<'deadlineAtMs' | 'attempt' | 'bids'>().toEqualTypeOf<keyof ThinkingMatchState>();
  expectTypeOf<keyof DemonstratingMatchState>().exclude<'deadlineAtMs'>().toEqualTypeOf<keyof DemonstratingMatchState>();
  expectTypeOf<Omit<BiddingMatchState, 'deadlineAtMs'>>().not.toExtend<BiddingMatchState>();
  expectTypeOf<Omit<DemonstratingMatchState, 'attempt'>>().not.toExtend<DemonstratingMatchState>();
});

test('only a successful outcome carries a winner and winning bid', () => {
  expectTypeOf<Extract<RoundOutcome, { kind: 'success' }>>().toExtend<{
    readonly winnerSeatId: string; readonly winningBid: number; readonly moveCount: number;
  }>();
  expectTypeOf<keyof Extract<RoundOutcome, { kind: 'no-bid-skip' }>>().toEqualTypeOf<'kind'>();
  expectTypeOf<keyof Extract<RoundOutcome, { kind: 'all-bidders-gave-up' }>>().toEqualTypeOf<'kind'>();
});

test('preparation status cannot retain selected solution proofs or reveal an active round', () => {
  expectTypeOf<Extract<PreparationStatus, { status: 'selected' }>>().toBeNever();
  expectTypeOf<Extract<PreparationStatus, { status: 'deferred' | 'unavailable' }>>()
    .toEqualTypeOf<Extract<RoundSetupResult, { status: 'deferred' | 'unavailable' }>>();
  expectTypeOf<keyof Extract<MatchState, { phase: 'preparing' }>>().exclude<'round'>()
    .toEqualTypeOf<keyof Extract<MatchState, { phase: 'preparing' }>>();
});

test('there is no eleventh round, and preparation/active play cannot follow ten completed rounds', () => {
  expectTypeOf<11>().not.toExtend<RoundNumber>();
  expectTypeOf<FinishedMatchState['completedRounds']>().toEqualTypeOf<10>();
  expectTypeOf<Extract<MatchState, { phase: 'preparing' | 'thinking' | 'bidding' | 'demonstrating' }>['completedRounds']>()
    .exclude<10>().toEqualTypeOf<0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9>();
  expectTypeOf<keyof FinishedMatchState>().exclude<'round' | 'attempt' | 'deadlineAtMs'>().toEqualTypeOf<keyof FinishedMatchState>();
});

test('trusted internal preparation and round advancement are not player commands', () => {
  type PlayerAction = Extract<MatchAction, { source: 'player' }>;
  type ControllerAction = Extract<MatchAction, { source: 'controller' }>;
  expectTypeOf<Extract<PlayerAction['command'], { type: 'round.prepared' | 'round.advance' | 'time.advance' }>>().toBeNever();
  expectTypeOf<Extract<ControllerAction['command'], { type: 'bid.submit' | 'attempt.move' }>>().toBeNever();
  expectTypeOf<Omit<PlayerAction['context'], 'actorSeatId'>>().not.toExtend<PlayerAction['context']>();
  expectTypeOf<Omit<MatchTransitionResult, 'state'>>().not.toExtend<MatchTransitionResult>();
});
