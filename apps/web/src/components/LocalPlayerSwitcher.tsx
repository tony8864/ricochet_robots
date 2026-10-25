import type { MatchPlayer } from '@robot-puzzle/match';

export function LocalPlayerSwitcher(props: {
  readonly players: readonly MatchPlayer[];
  readonly hostSeatId: string;
  readonly actingSeatId: string;
  readonly onActAs: (seatId: string) => void;
}) {
  return (
    <aside aria-label="Local development tools" className="local-tools">
      <span>Local simulation · development only</span>
      <label>
        Act as{' '}
        <select value={props.actingSeatId} onChange={(event) => props.onActAs(event.target.value)}>
          {props.players.map((player) => (
            <option key={player.seatId} value={player.seatId}>
              {player.nickname}{player.seatId === props.hostSeatId ? ' (Host)' : ''}
            </option>
          ))}
        </select>
      </label>
    </aside>
  );
}
