import { isTargetComplete } from '@robot-puzzle/game-engine';
import type { RoundOutcome, UnfinishedRoundCount } from '@robot-puzzle/match';
import type { PublicMatch, PublicPlayer, PublicPuzzle, PublicRoomState, PublicRound, PublicStateResult } from './publicState';
import { exactKeys } from './requestValidation';
import {
  bids, boardId, canonicalCode, check, fields, id, integer, list, players,
  puzzle, record, robots, roundNumber, sameRobots,
} from './stateValidation';

const ROOM_FIELDS = ['roomId', 'roomCode', 'revision', 'hostSeatId', 'players', 'puzzle', 'status'];
const MATCH_FIELDS = ['matchId', 'phase', 'completedRounds', 'scores', 'officialRobots', 'usedTargetIds'];
function unfinished(value: unknown): UnfinishedRoundCount {
  // All literals 0–9 are members of the existing pure match count union.
  return integer(value, 0, 9) as UnfinishedRoundCount;
}
function parseRound(value: unknown, board: PublicPuzzle): PublicRound {
  const item = fields(value, ['number', 'targetId', 'startRobots']);
  return { number: roundNumber(item.number), targetId: boardId(item.targetId), startRobots: robots(item.startRobots, board.board) };
}
function parseOutcome(value: unknown, roster: readonly PublicPlayer[], scores: Readonly<Record<string, number>>): RoundOutcome {
  const item = record(value);
  if (item.kind === 'success') {
    check(exactKeys(item, ['kind', 'winnerSeatId', 'winningBid', 'moveCount']));
    const winnerSeatId = id(item.winnerSeatId);
    check(roster.some((player) => player.seatId === winnerSeatId) && scores[winnerSeatId] > 0);
    const winningBid = integer(item.winningBid, 1);
    return { kind: 'success', winnerSeatId, winningBid, moveCount: integer(item.moveCount, 1, winningBid) };
  }
  check(exactKeys(item, ['kind']));
  check(item.kind === 'all-bidders-gave-up' || item.kind === 'no-bid-skip');
  return { kind: item.kind };
}
function parseMatch(value: unknown, board: PublicPuzzle, roster: readonly PublicPlayer[]): PublicMatch {
  const item = record(value);
  let extra: readonly string[];
  switch (item.phase) {
    case 'preparing': extra = ['preparation']; break;
    case 'thinking': extra = ['round']; break;
    case 'bidding': extra = ['round', 'bids', 'deadlineAtMs']; break;
    case 'demonstrating': extra = ['round', 'bidderQueue', 'activeBidderIndex', 'attempt']; break;
    case 'round-result': extra = ['round', 'outcome']; break;
    case 'finished': extra = []; break;
    default: throw new Error('Invalid phase');
  }
  check(exactKeys(item, [...MATCH_FIELDS, ...extra]));
  const completedRounds = integer(item.completedRounds, 0, 10);
  const scoreValues = fields(item.scores, roster.map((player) => player.seatId));
  const scores = Object.fromEntries(roster.map((player) => [player.seatId, integer(scoreValues[player.seatId], 0, 10)]));
  check(Object.values(scores).reduce((sum, score) => sum + score, 0) <= completedRounds);
  const usedTargetIds = list(item.usedTargetIds, 0, 10).map(boardId);
  check(new Set(usedTargetIds).size === usedTargetIds.length);
  check(usedTargetIds.every((targetId) => board.targets.some((target) => target.id === targetId)));
  const base = { matchId: id(item.matchId), scores, officialRobots: robots(item.officialRobots, board.board), usedTargetIds };
  if (item.phase === 'finished') {
    check(completedRounds === 10 && usedTargetIds.length === 10);
    return { ...base, phase: 'finished', completedRounds: 10 };
  }
  if (item.phase === 'preparing') {
    check(usedTargetIds.length === completedRounds);
    const prepItem = record(item.preparation);
    const preparation = fields(prepItem, prepItem.retry === undefined ? ['status'] : ['status', 'retry']);
    check(preparation.status === 'working' || preparation.status === 'deferred' || preparation.status === 'unavailable' || preparation.status === 'error');
    let retry;
    if (preparation.retry !== undefined) {
      check(preparation.status === 'deferred' || preparation.status === 'error');
      const metadata = fields(preparation.retry, ['preparationId', 'availableAtMs']);
      retry = { preparationId: id(metadata.preparationId), availableAtMs: integer(metadata.availableAtMs) };
    }
    return { ...base, phase: 'preparing', completedRounds: unfinished(completedRounds),
      preparation: { status: preparation.status, ...(retry ? { retry } : {}) } };
  }
  const round = parseRound(item.round, board);
  const target = board.targets.find((target) => target.id === round.targetId);
  check(target && usedTargetIds.at(-1) === target.id && !isTargetComplete(round.startRobots, target));
  if (item.phase === 'round-result') {
    check(round.number === completedRounds && usedTargetIds.length === completedRounds);
    const outcome = parseOutcome(item.outcome, roster, scores);
    check(outcome.kind === 'success' ? isTargetComplete(base.officialRobots, target) : sameRobots(base.officialRobots, round.startRobots));
    return { ...base, phase: 'round-result', completedRounds: roundNumber(completedRounds), round, outcome };
  }
  check(round.number === completedRounds + 1 && usedTargetIds.length === completedRounds + 1);
  check(sameRobots(base.officialRobots, round.startRobots));
  const count = unfinished(completedRounds);
  if (item.phase === 'thinking') return { ...base, phase: 'thinking', completedRounds: count, round };
  if (item.phase === 'bidding') return {
    ...base, phase: 'bidding', completedRounds: count, round,
    bids: bids(item.bids, roster, false), deadlineAtMs: integer(item.deadlineAtMs),
  };
  const bidderQueue = bids(item.bidderQueue, roster, true);
  const activeBidderIndex = integer(item.activeBidderIndex, 0, bidderQueue.length - 1);
  const attempt = fields(item.attempt, ['id', 'version', 'robots', 'moveCount']);
  const moveCount = integer(attempt.moveCount, 0, bidderQueue[activeBidderIndex].value);
  const version = integer(attempt.version, moveCount);
  const attemptRobots = robots(attempt.robots, board.board);
  check(moveCount !== 0 || sameRobots(attemptRobots, round.startRobots));
  check(!isTargetComplete(attemptRobots, target));
  return {
    ...base, phase: 'demonstrating', completedRounds: count, round, bidderQueue, activeBidderIndex,
    attempt: { id: id(attempt.id), version, robots: attemptRobots, moveCount },
  };
}

/** Validate bounded public data and copy it; never authenticate or run a solver. */
export function parsePublicRoomState(value: unknown): PublicStateResult {
  try {
    const item = record(value);
    check(item.status === 'lobby' || item.status === 'playing' || item.status === 'finished');
    check(exactKeys(item, [...ROOM_FIELDS, item.status === 'lobby' ? 'lobbyId' : 'match']));
    const roster = players(item.players, item.status === 'lobby' ? 1 : 2);
    const hostSeatId = id(item.hostSeatId);
    check(roster.some((player) => player.seatId === hostSeatId));
    const board = puzzle(item.puzzle);
    const base = {
      roomId: id(item.roomId), roomCode: canonicalCode(item.roomCode), revision: integer(item.revision),
      hostSeatId, players: roster, puzzle: board,
    };
    let state: PublicRoomState;
    if (item.status === 'lobby') state = { ...base, status: 'lobby', lobbyId: id(item.lobbyId) };
    else {
      const match = parseMatch(item.match, board, roster);
      if (item.status === 'finished') { check(match.phase === 'finished'); state = { ...base, status: 'finished', match }; }
      else { check(match.phase !== 'finished'); state = { ...base, status: 'playing', match }; }
    }
    return { ok: true, value: state };
  } catch {
    return { ok: false, error: 'invalid-snapshot' };
  }
}
