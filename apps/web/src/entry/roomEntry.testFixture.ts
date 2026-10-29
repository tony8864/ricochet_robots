import { starterBoard } from '@robot-puzzle/puzzles';
import { projectLobbyState, type RoomEnteredMessage } from '@robot-puzzle/shared';

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
