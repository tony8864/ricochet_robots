import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RoomEnteredMessage } from '@robot-puzzle/shared';
import type { RobotId } from '@robot-puzzle/game-engine';
import { liveLobbyClient, type LiveLobbyClient } from '../lobby/liveLobbyClient';
import { LobbyPreview } from './LobbyPreview';
import { RoomCode } from './RoomCode';
import { BidCard } from './BidCard';
import { PlayerRoster } from './PlayerRoster';
import { ConnectedBiddingCountdown } from './ConnectedBiddingCountdown';
import { DemonstrationControls } from './DemonstrationControls';
import { RoundResultModal } from './RoundResultModal';
import { MatchResults } from './MatchResults';

export function ConnectedLobby({ entry, client }: { readonly entry: RoomEnteredMessage; readonly client?: LiveLobbyClient }) {
  const [flow] = useState(() => client ?? liveLobbyClient(entry));
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  const [selection, setSelection] = useState<{ attemptId: string; robotId: RobotId } | null>(null);
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
  const roundResult = state.room.status === 'playing' && state.room.match.phase === 'round-result';
  const match = state.room.status === 'playing' ? state.room.match : null;
  const preparation = match?.phase === 'preparing' ? match.preparation : null;
  const isHost = state.room.hostSeatId === entry.seatId;
  const unresolved = state.start !== 'idle' || state.shuffle !== 'idle' || state.preparation !== 'idle' || state.bid !== 'idle' || state.attempt !== 'idle' || state.round !== 'idle' || state.rematch !== 'idle';
  const pendingRetry = (state.start === 'retry' || state.shuffle === 'retry' || state.preparation === 'retry' || state.bid === 'retry' || state.attempt === 'retry' || state.round === 'retry' || state.rematch === 'retry') &&
    <button type="button" className="room-code__copy" disabled={!connected} onClick={flow.retry}>Retry pending request</button>;
  if (state.room.status === 'finished') return <MatchResults
    match={{ ...state.room.match, players: state.room.players }} currentSeatId={entry.seatId} hostSeatId={state.room.hostSeatId}
    onNewMatch={flow.returnToLobby} pending={state.rematch === 'pending'} disabled={!connected || unresolved}
    feedback={!connected || state.actionError || pendingRetry ? <>
      {status}{state.actionError && <p className="connected-lobby__error" role="alert">{state.actionError}</p>}{pendingRetry}
    </> : undefined} />;
  if (state.room.status !== 'lobby' && !preparing && !thinking && !bidding && !demonstrating && !roundResult) return <main className="board-preview connected-lobby">
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
  const isActive = activeBid?.seatId === entry.seatId;
  const attemptId = match?.phase === 'demonstrating' ? match.attempt.id : '';
  const selectedRobot = selection?.attemptId === attemptId ? selection.robotId : 'red';
  const selectRobot = (robotId: RobotId) => setSelection({ attemptId, robotId });
  const error = state.actionError && <p className="connected-lobby__error" role="alert">{state.actionError}</p>;

  return <main className="board-preview connected-lobby">
    <div className="connected-lobby__content">
      <LobbyPreview puzzle={state.room.puzzle} players={state.room.players} hostSeatId={state.room.hostSeatId}
        currentSeatId={entry.seatId} headerAside={<div className="round-header__actions"><RoomCode code={state.room.roomCode} />
          {match?.phase === 'bidding' && <ConnectedBiddingCountdown deadlineAtMs={match.deadlineAtMs} getServerNow={flow.getServerNow} />}
          {thinking && isHost && <button type="button" className="skip-round" disabled={!connected || unresolved} onClick={flow.skipRound}>Skip Round</button>}
        </div>} status={status}
        onShuffle={flow.shuffle} onStart={flow.start} showActions={state.room.status === 'lobby'}
        heading={preparing ? 'Preparing round' : thinking ? 'Thinking' : bidding ? 'Bidding' : demonstrating ? 'Demonstration' : roundResult ? 'Round complete' : 'Match setup'}
        eyebrow={match ? `Round ${'round' in match ? match.round.number : match.completedRounds + 1} of 10` : undefined}
        detail={targetLabel ? `${state.room.puzzle.name} · Target: ${targetLabel}` : state.room.puzzle.name}
        robots={match?.phase === 'demonstrating' ? match.attempt.robots : match?.officialRobots}
        activeTargetId={match && 'round' in match ? match.round.targetId : null}
        boardKey={state.boardEpoch} selectedRobot={isActive && connected ? selectedRobot : null}
        onRobotSelect={isActive && connected ? selectRobot : undefined}
        roster={thinking || bidding ? <div className="bidding-panels">
          <BidCard key={`${match?.matchId}:${match && 'round' in match ? match.round.number : 0}:${entry.seatId}`}
            disabled={!connected || unresolved || !state.bidWindowOpen} pending={state.bid === 'pending'} acceptedBid={bid} onPlaceBid={flow.placeBid} />
          {bidding && !state.bidWindowOpen && <p className="connected-lobby__notice">Waiting for the server to close bidding.</p>}
          <PlayerRoster variant="bids" players={state.room.players} bids={match?.phase === 'bidding' ? match.bids : []} currentSeatId={entry.seatId} />
        </div> : demonstrating && match?.phase === 'demonstrating' ? <>
          <section className="connected-lobby__notice" aria-label="Demonstration status">
            <p>{`${activeName} is demonstrating · Bid: ${activeBid?.value}`}</p>
            <p>{`Moves: ${match.attempt.moveCount} / ${activeBid?.value}`}</p>
          </section>
          {isActive ? <DemonstrationControls selectedRobot={selectedRobot} moveCount={match.attempt.moveCount}
            onSelect={selectRobot} onMove={(direction) => flow.move(selectedRobot, direction)}
            onUndo={flow.undo} onReset={flow.reset} onGiveUp={flow.giveUp}
            disabled={!connected || unresolved} selectionDisabled={!connected}
            feedback={state.attempt === 'pending' ? 'Waiting for the server…' : state.attempt === 'retry'
              ? 'The last action is unresolved. Retry the pending request.' : state.attemptFeedback || null} />
            : <p className="connected-lobby__notice">Watching {activeName}. Only the active bidder can control the robots.</p>}
        </> : roundResult ? <></> : undefined}
        startDisabled={!connected || state.room.players.length < 2 || (unresolved && state.start !== 'retry')}
        shuffleDisabled={!connected || (unresolved && state.shuffle !== 'retry')}
        startLabel={state.start === 'pending' ? 'Starting…' : state.start === 'retry' ? 'Retry Start' : 'Start Match'}
        shuffleLabel={state.shuffle === 'pending' ? 'Shuffling…' : state.shuffle === 'retry' ? 'Retry Shuffle' : 'Shuffle Board'} />
      {!roundResult && error}
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
      </section> : state.room.status === 'lobby' && state.room.players.length < 2 && <p className="connected-lobby__notice">At least two players are needed to start.</p>}
      {!roundResult && pendingRetry}
      {match?.phase === 'round-result' && <RoundResultModal key={`${match.matchId}:${match.round.number}`}
        match={{ round: match.round, outcome: match.outcome, players: state.room.players }}
        isHost={isHost} hostName={state.room.players.find((player) => player.seatId === state.room.hostSeatId)!.nickname}
        onContinue={flow.continueRound} pending={state.round === 'pending'} disabled={!connected || unresolved}
        recovery={!connected || state.actionError || pendingRetry ? <>{status}{error}{pendingRetry}</> : undefined} />}
    </div>
  </main>;
}
