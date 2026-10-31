import { starterBoard } from '@robot-puzzle/puzzles';
import { createMatch, prepareMatchRound } from '@robot-puzzle/match';
import { RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import { projectLobbyState, projectMatchState, type PublicRoomState, type RoomEnteredMessage } from '@robot-puzzle/shared';

export const entryTestId = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

export function roomEnteredFixture(commandId: string, nickname = 'Maria'): RoomEnteredMessage {
  const result = projectLobbyState({
    roomId: entryTestId(100), roomCode: 'ABC234', revision: 1, hostSeatId: entryTestId(101),
    lobbyId: entryTestId(102), players: [{ seatId: entryTestId(101), nickname, connected: false }], puzzle: starterBoard,
  });
  if (!result.ok) throw new Error('Invalid entry test fixture');
  return { version: 1, type: 'room.entered', commandId, roomId: result.value.roomId,
    seatId: entryTestId(101), membership: 'created', state: result.value, serverTimeMs: 1_000 };
}

export function preparingRoomFixture(room: PublicRoomState): PublicRoomState {
  const match = createMatch({ matchId: entryTestId(200), players: room.players, puzzle: room.puzzle });
  const projected = projectMatchState({ ...room, revision: room.revision + 1, match,
    connections: Object.fromEntries(room.players.map((player) => [player.seatId, player.connected])),
    preparation: { matchId: match.matchId, completedRounds: 0, activity: 'idle' } });
  if (!projected.ok) throw new Error('Expected Preparing fixture');
  return projected.value;
}

export function failedPreparationFixture(room: PublicRoomState, status: 'deferred' | 'error' | 'unavailable' = 'error'): PublicRoomState {
  const state = preparingRoomFixture(room);
  if (state.status !== 'playing' || state.match.phase !== 'preparing') throw new Error('Expected Preparing');
  return { ...state, match: { ...state.match, preparation: { status,
    ...(status !== 'unavailable' ? { retry: { preparationId: entryTestId(201), availableAtMs: 5100 } } : {}),
  } } };
}

export function thinkingRoomFixture(room: PublicRoomState): PublicRoomState {
  const initial = createMatch({ matchId: entryTestId(200), players: room.players, puzzle: room.puzzle });
  const match = prepareMatchRound(initial, { candidateOrder: room.puzzle.targets.map((t) => t.id), budget: RECOMMENDED_ROUND_SETUP_BUDGET }).state;
  if (match.phase !== 'thinking') throw new Error('Expected verified Thinking');
  const projected = projectMatchState({ ...room, revision: room.revision + 1, match,
    connections: Object.fromEntries(room.players.map((p) => [p.seatId, p.connected])) });
  if (!projected.ok) throw new Error('Expected Thinking projection');
  return projected.value;
}

export function biddingRoomFixture(room: PublicRoomState, values: readonly number[] = [7], startAtMs = 100): PublicRoomState {
  const thinking = thinkingRoomFixture(room);
  if (thinking.status !== 'playing' || thinking.match.phase !== 'thinking') throw new Error('Expected Thinking');
  const bids = values.map((value, index) => ({ seatId: room.players[index].seatId, value, firstAcceptedOrder: index }));
  if (!bids[0]) throw new Error('Expected first bid');
  return { ...thinking, match: { ...thinking.match, phase: 'bidding', deadlineAtMs: startAtMs + 60000, bids: [bids[0], ...bids.slice(1)] } };
}

export function demonstratingRoomFixture(room: PublicRoomState): PublicRoomState {
  const bidding = biddingRoomFixture(room, [7, 5]);
  if (bidding.status !== 'playing' || bidding.match.phase !== 'bidding') throw new Error('Expected Bidding');
  const { bids, deadlineAtMs: _deadline, ...base } = bidding.match;
  const queue = [...bids].sort((a, b) => a.value - b.value || a.firstAcceptedOrder - b.firstAcceptedOrder);
  return { ...bidding, match: { ...base, phase: 'demonstrating', bidderQueue: [queue[0], ...queue.slice(1)], activeBidderIndex: 0,
    attempt: { id: entryTestId(210), version: 0, robots: base.round.startRobots, moveCount: 0 } } };
}
