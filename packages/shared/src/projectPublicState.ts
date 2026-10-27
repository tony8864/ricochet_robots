import type { Coordinate, RobotPositions, Target } from '@robot-puzzle/game-engine';
import type { MatchBid, MatchState } from '@robot-puzzle/match';
import type { LobbyProjectionInput, MatchProjectionInput, PublicPuzzle, PublicStateResult } from './publicState';
import { parsePublicRoomState } from './parsePublicRoomState';
import { boolean, check, fields, list, sameRobots } from './stateValidation';

const point = (value: Coordinate) => ({ row: value.row, column: value.column });
const positions = (value: RobotPositions) => ({ red: point(value.red), blue: point(value.blue), green: point(value.green), yellow: point(value.yellow) });
function selectedPuzzle(value: PublicPuzzle): unknown {
  return {
    id: value.id, name: value.name,
    board: {
      blockedCells: list(value.board.blockedCells, 4, 4).map((_, index) => point(value.board.blockedCells[index])),
      walls: list(value.board.walls, 0, 480).map((_, index) => {
        const wall = value.board.walls[index];
        return { first: point(wall.first), second: point(wall.second) };
      }),
    },
    targets: list(value.targets, 17, 17).map((_, index) => {
      const target: Target = value.targets[index];
      const base = { id: target.id, kind: target.kind, symbol: target.symbol, position: point(target.position) };
      return target.kind === 'colored' ? { ...base, robotId: target.robotId } : base;
    }),
    initialRobots: positions(value.initialRobots),
  };
}
const bid = (value: MatchBid) => ({ seatId: value.seatId, value: value.value, firstAcceptedOrder: value.firstAcceptedOrder });
function publicMatch(input: MatchProjectionInput): unknown {
  const match: MatchState = input.match;
  const scores = fields(match.scores, match.players.map((player) => player.seatId));
  const common = {
    matchId: match.matchId, phase: match.phase, completedRounds: match.completedRounds,
    scores: Object.fromEntries(match.players.map((player) => [player.seatId, scores[player.seatId]])),
    officialRobots: positions(match.officialRobots), usedTargetIds: [...list(match.usedTargetIds, 0, 10)],
  };
  if (match.phase === 'finished') return common;
  if (match.phase === 'preparing') {
    check('preparation' in input);
    const metadata = input.preparation;
    check(metadata.matchId === match.matchId && metadata.completedRounds === match.completedRounds);
    check(metadata.activity === 'pending' || metadata.activity === 'failed' || metadata.activity === 'idle');
    check(match.preparation.status === 'not-attempted' || match.preparation.status === 'deferred' || match.preparation.status === 'unavailable');
    const status = metadata.activity === 'pending' ? 'working' : metadata.activity === 'failed' ? 'error'
      : match.preparation.status === 'not-attempted' ? 'working' : match.preparation.status;
    return { ...common, preparation: { status } };
  }
  const target = match.puzzle.targets.find((target) => target.id === match.round.target.id);
  check(target && target.kind === match.round.target.kind && target.symbol === match.round.target.symbol &&
    target.position.row === match.round.target.position.row && target.position.column === match.round.target.position.column &&
    (target.kind !== 'colored' || (match.round.target.kind === 'colored' && target.robotId === match.round.target.robotId)));
  const round = { number: match.round.number, targetId: match.round.target.id, startRobots: positions(match.round.startRobots) };
  if (match.phase === 'thinking') return { ...common, round };
  if (match.phase === 'bidding') return {
    ...common, round, bids: list(match.bids, 1, 6).map((_, index) => bid(match.bids[index])), deadlineAtMs: match.deadlineAtMs,
  };
  if (match.phase === 'round-result') {
    const outcome = match.outcome;
    check(outcome.kind === 'success' || outcome.kind === 'all-bidders-gave-up' || outcome.kind === 'no-bid-skip');
    return { ...common, round, outcome: outcome.kind === 'success'
      ? { kind: outcome.kind, winnerSeatId: outcome.winnerSeatId, winningBid: outcome.winningBid, moveCount: outcome.moveCount }
      : { kind: outcome.kind } };
  }
  check('attempt' in input);
  check(sameRobots(match.attempt.roundStartRobots, match.round.startRobots));
  const metadata = input.attempt;
  const queue = list(match.bidderQueue, 1, 6).map((_, index) => bid(match.bidderQueue[index]));
  check(metadata.matchId === match.matchId && metadata.roundNumber === match.round.number &&
    metadata.activeBidderIndex === match.activeBidderIndex && metadata.seatId === queue[match.activeBidderIndex]?.seatId);
  // History is never copied or traversed; only its retained length is public.
  check(Array.isArray(match.attempt.moves));
  return {
    ...common, round, bidderQueue: queue, activeBidderIndex: match.activeBidderIndex,
    attempt: { id: metadata.id, version: metadata.version, robots: positions(match.attempt.robots), moveCount: match.attempt.moves.length },
  };
}
const roomMetadata = (input: LobbyProjectionInput | MatchProjectionInput) => ({
  roomId: input.roomId, roomCode: input.roomCode, revision: input.revision, hostSeatId: input.hostSeatId,
});
const invalid = (): PublicStateResult => ({ ok: false, error: 'invalid-projection' });
function finish(value: unknown): PublicStateResult {
  const parsed = parsePublicRoomState(value);
  return parsed.ok ? parsed : invalid();
}
/** Explicit allowlist copying; private source fields are never serialized. */
export function projectLobbyState(input: LobbyProjectionInput): PublicStateResult {
  try {
    list(input.players, 1, 6);
    return finish({
      ...roomMetadata(input), status: 'lobby', lobbyId: input.lobbyId,
      players: input.players.map((player) => ({ seatId: player.seatId, nickname: player.nickname, connected: player.connected })),
      puzzle: selectedPuzzle(input.puzzle),
    });
  } catch { return invalid(); }
}
export function projectMatchState(input: MatchProjectionInput): PublicStateResult {
  try {
    list(input.match.players, 2, 6);
    const connections = fields(input.connections, input.match.players.map((player) => player.seatId));
    return finish({
      ...roomMetadata(input), status: input.match.phase === 'finished' ? 'finished' : 'playing',
      players: input.match.players.map((player) => ({ seatId: player.seatId, nickname: player.nickname, connected: boolean(connections[player.seatId]) })),
      puzzle: selectedPuzzle(input.match.puzzle), match: publicMatch(input),
    });
  } catch { return invalid(); }
}
