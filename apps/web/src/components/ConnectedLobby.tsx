import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RoomEnteredMessage } from '@robot-puzzle/shared';
import { liveLobbyClient, type LiveLobbyClient } from '../lobby/liveLobbyClient';
import { LobbyPreview } from './LobbyPreview';
import { RoomCode } from './RoomCode';

export function ConnectedLobby({ entry, client }: { readonly entry: RoomEnteredMessage; readonly client?: LiveLobbyClient }) {
  const [flow] = useState(() => client ?? liveLobbyClient(entry));
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  useEffect(() => { flow.connect(); return () => flow.disconnect(); }, [flow]);
  const connected = state.connection === 'connected';
  const canReconnect = state.connection === 'disconnected' || state.connection === 'error';
  const status = <div className="connected-lobby__status">
    <p role="status">{state.message}{connected ? ` · ${state.room.players.filter((player) => player.connected).length} online` : ''}</p>
    {canReconnect && <button type="button" className="room-code__copy" onClick={flow.connect}>Reconnect</button>}
  </div>;

  const preparing = state.room.status === 'playing' && state.room.match.phase === 'preparing';
  if (state.room.status !== 'lobby' && !preparing) return <main className="board-preview connected-lobby">
    <div className="connected-lobby__content"><RoomCode code={state.room.roomCode} />{status}
      <p>This room has already started. Live match screens are not connected yet.</p>
    </div>
  </main>;

  return <main className="board-preview connected-lobby">
    <div className="connected-lobby__content">
      <LobbyPreview puzzle={state.room.puzzle} players={state.room.players} hostSeatId={state.room.hostSeatId}
        currentSeatId={entry.seatId} headerAside={<RoomCode code={state.room.roomCode} />} status={status}
        onShuffle={flow.shuffle} onStart={flow.start} showActions={!preparing} heading={preparing ? 'Preparing match' : 'Match setup'}
        startDisabled={!connected || state.room.players.length < 2 || state.start === 'pending' || state.shuffle !== 'idle'}
        shuffleDisabled={!connected || state.shuffle === 'pending' || state.start !== 'idle'}
        startLabel={state.start === 'pending' ? 'Starting…' : state.start === 'retry' ? 'Retry Start' : 'Start Match'}
        shuffleLabel={state.shuffle === 'pending' ? 'Shuffling…' : state.shuffle === 'retry' ? 'Retry Shuffle' : 'Shuffle Board'} />
      {state.actionError && <p className="connected-lobby__error" role="alert">{state.actionError}</p>}
      {preparing ? <section className="connected-lobby__notice" aria-label="Match preparation">
        <p role="status">Match started. First-target preparation will be connected next. No target has been revealed.</p>
        {connected && (state.start === 'retry' || state.shuffle === 'retry') && <button type="button" className="room-code__copy" onClick={flow.retry}>Retry pending request</button>}
      </section> : state.room.players.length < 2 && <p className="connected-lobby__notice">At least two players are needed to start.</p>}
    </div>
  </main>;
}
