import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RoomEnteredMessage } from '@robot-puzzle/shared';
import { liveLobbyClient, type LiveLobbyClient } from '../lobby/liveLobbyClient';
import { LobbyPreview } from './LobbyPreview';
import { RoomCode } from './RoomCode';
import { BidCard } from './BidCard';
import { PlayerRoster } from './PlayerRoster';
import { ConnectedBiddingCountdown } from './ConnectedBiddingCountdown';

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
  const thinking = state.room.status === 'playing' && state.room.match.phase === 'thinking';
  const bidding = state.room.status === 'playing' && state.room.match.phase === 'bidding';
  const demonstrating = state.room.status === 'playing' && state.room.match.phase === 'demonstrating';
  const match = state.room.status === 'playing' ? state.room.match : null;
  const preparation = match?.phase === 'preparing' ? match.preparation : null;
  const isHost = state.room.hostSeatId === entry.seatId;
  const unresolved = state.start !== 'idle' || state.shuffle !== 'idle' || state.preparation !== 'idle' || state.bid !== 'idle';
  const pendingRetry = (state.start === 'retry' || state.shuffle === 'retry' || state.preparation === 'retry' || state.bid === 'retry') &&
    <button type="button" className="room-code__copy" disabled={!connected} onClick={flow.retry}>Retry pending request</button>;
  if (state.room.status !== 'lobby' && !preparing && !thinking && !bidding && !demonstrating) return <main className="board-preview connected-lobby">
    <div className="connected-lobby__content"><RoomCode code={state.room.roomCode} />{status}
      <p>This room has already started. Live match screens are not connected yet.</p>
      {state.actionError && <p className="connected-lobby__error" role="alert">{state.actionError}</p>}{pendingRetry}
    </div>
  </main>;

  const target = match && 'round' in match ? state.room.puzzle.targets.find((item) => item.id === match.round.targetId) : null;
  const targetLabel = target ? target.kind === 'colored' ? `${target.robotId} ${target.symbol}` : 'wildcard vortex' : null;
  const bid = match?.phase === 'bidding' ? match.bids.find((item) => item.seatId === entry.seatId)?.value : undefined;
  const activeBid = match?.phase === 'demonstrating' ? match.bidderQueue[match.activeBidderIndex] : null;
  const activeName = state.room.players.find((player) => player.seatId === activeBid?.seatId)?.nickname;

  return <main className="board-preview connected-lobby">
    <div className="connected-lobby__content">
      <LobbyPreview puzzle={state.room.puzzle} players={state.room.players} hostSeatId={state.room.hostSeatId}
        currentSeatId={entry.seatId} headerAside={<div className="round-header__actions"><RoomCode code={state.room.roomCode} />
          {match?.phase === 'bidding' && <ConnectedBiddingCountdown deadlineAtMs={match.deadlineAtMs} getServerNow={flow.getServerNow} />}
        </div>} status={status}
        onShuffle={flow.shuffle} onStart={flow.start} showActions={state.room.status === 'lobby'}
        heading={preparing ? 'Preparing round' : thinking ? 'Thinking' : bidding ? 'Bidding' : demonstrating ? 'Demonstration' : 'Match setup'}
        eyebrow={match ? `Round ${match.completedRounds + 1} of 10` : undefined}
        detail={targetLabel ? `${state.room.puzzle.name} · Target: ${targetLabel}` : state.room.puzzle.name}
        robots={match?.phase === 'demonstrating' ? match.attempt.robots : match?.officialRobots}
        activeTargetId={match && 'round' in match ? match.round.targetId : null}
        roster={thinking || bidding ? <div className="bidding-panels">
          <BidCard key={`${match?.matchId}:${match && 'round' in match ? match.round.number : 0}:${entry.seatId}`}
            disabled={!connected || unresolved || !state.bidWindowOpen} pending={state.bid === 'pending'} acceptedBid={bid} onPlaceBid={flow.placeBid} />
          {bidding && !state.bidWindowOpen && <p className="connected-lobby__notice">Waiting for the server to close bidding.</p>}
          <PlayerRoster variant="bids" players={state.room.players} bids={match?.phase === 'bidding' ? match.bids : []} currentSeatId={entry.seatId} />
        </div> : demonstrating && match?.phase === 'demonstrating' ? <section className="connected-lobby__notice" aria-label="Demonstration status">
          <p>{`${activeName} is demonstrating · Bid: ${activeBid?.value}`}</p>
          <p>{`Moves: ${match.attempt.moveCount} / ${activeBid?.value}`}</p>
          <p>Demonstration controls will be connected in T16.</p>
        </section> : undefined}
        startDisabled={!connected || state.room.players.length < 2 || state.start === 'pending' || state.shuffle !== 'idle'}
        shuffleDisabled={!connected || state.shuffle === 'pending' || state.start !== 'idle'}
        startLabel={state.start === 'pending' ? 'Starting…' : state.start === 'retry' ? 'Retry Start' : 'Start Match'}
        shuffleLabel={state.shuffle === 'pending' ? 'Shuffling…' : state.shuffle === 'retry' ? 'Retry Shuffle' : 'Shuffle Board'} />
      {state.actionError && <p className="connected-lobby__error" role="alert">{state.actionError}</p>}
      {preparing ? <section className="connected-lobby__notice" aria-label="Match preparation">
        <p role="status">{preparation?.status === 'working' ? 'Preparing a verified target…'
          : preparation?.status === 'deferred' ? 'No target was verified within the search limit. The board and robot positions are unchanged.'
          : preparation?.status === 'unavailable' ? 'No eligible target is available. Preparation cannot continue from this position.'
          : 'Target preparation could not be completed. The board and robot positions are unchanged.'}</p>
        {preparation?.retry && (preparation.status === 'deferred' || preparation.status === 'error') && (isHost ? <>
          <button type="button" className="room-code__copy" disabled={!connected || !state.canRetryPreparation || unresolved}
            onClick={flow.retryPreparation}>{state.preparation === 'pending' ? 'Retrying preparation…' : 'Retry preparation'}</button>
          {!state.canRetryPreparation && connected && <p>Retry will be available shortly.</p>}
        </> : <p>Waiting for {state.room.players.find((player) => player.seatId === state.room.hostSeatId)?.nickname} to retry preparation.</p>)}
      </section> : state.room.players.length < 2 && <p className="connected-lobby__notice">At least two players are needed to start.</p>}
      {state.room.status !== 'lobby' && pendingRetry}
    </div>
  </main>;
}
