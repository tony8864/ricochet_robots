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

  if (state.room.status !== 'lobby') return <main className="board-preview connected-lobby">
    <div className="connected-lobby__content"><RoomCode code={state.room.roomCode} />{status}
      <p>This room has already started. Live match screens are not connected yet.</p>
    </div>
  </main>;

  return <main className="board-preview connected-lobby">
    <div className="connected-lobby__content">
      <LobbyPreview puzzle={state.room.puzzle} players={state.room.players} hostSeatId={state.room.hostSeatId}
        currentSeatId={entry.seatId} headerAside={<RoomCode code={state.room.roomCode} />} status={status}
        onShuffle={flow.shuffle} onStart={() => {}} startDisabled
        shuffleDisabled={!connected || state.shuffle === 'pending'}
        shuffleLabel={state.shuffle === 'pending' ? 'Shuffling…' : state.shuffle === 'retry' ? 'Retry Shuffle' : 'Shuffle Board'} />
      {state.actionError && <p className="connected-lobby__error" role="alert">{state.actionError}</p>}
      {state.room.hostSeatId === entry.seatId && <p className="connected-lobby__notice">Live Start Match will be connected in the next step.</p>}
    </div>
  </main>;
}
