export function LobbyActions({ isHost, hostNickname, onShuffle, onStart }: {
  readonly isHost: boolean;
  readonly hostNickname: string;
  readonly onShuffle: () => void;
  readonly onStart: () => void;
}) {
  if (!isHost) {
    return <p className="lobby-waiting" role="status">Waiting for {hostNickname} to start the match.</p>;
  }

  return (
    <div className="lobby-actions" role="group" aria-label="Lobby actions">
      <button className="lobby-actions__button lobby-actions__button--shuffle" type="button" onClick={onShuffle}>
        <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m18 2 4 4-4 4M18 14l4 4-4 4M2 18h2.5c6 0 9-12 15-12H22M2 6h2.5c2.5 0 4.5 2.1 6.3 4.8M14 15.2c1.7 1.7 3.3 2.8 5.5 2.8H22" />
        </svg>
        <span>Shuffle Board</span>
      </button>
      <button
        className="lobby-actions__button lobby-actions__button--start"
        type="button"
        onClick={onStart}
      >
        <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="m7 4 14 8-14 8Z" />
        </svg>
        <span>Start Match</span>
      </button>
    </div>
  );
}
