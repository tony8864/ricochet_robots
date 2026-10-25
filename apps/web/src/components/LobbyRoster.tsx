import type { MatchPlayer } from '@robot-puzzle/match';
import { PlayerRoster } from './PlayerRoster';

/** Lobby presentation only; seat identity, host authority, and scores stay elsewhere. */
export function LobbyRoster({ players, hostSeatId, currentSeatId }: {
  readonly players: readonly MatchPlayer[];
  readonly hostSeatId: string;
  readonly currentSeatId: string;
}) {
  return (
    <PlayerRoster variant="lobby" players={players} hostSeatId={hostSeatId} currentSeatId={currentSeatId} />
  );
}
