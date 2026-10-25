import { useState, useSyncExternalStore } from 'react';
import { type Direction, type RobotId } from '@robot-puzzle/game-engine';
import { BoardSvg } from './components/BoardSvg';
import { DemonstrationControls } from './components/DemonstrationControls';
import { LocalPlayerSwitcher } from './components/LocalPlayerSwitcher';
import { PreparationPanel } from './components/PreparationPanel';
import { BidCard } from './components/BidCard';
import { PlayerRoster } from './components/PlayerRoster';
import { BiddingCountdown } from './components/BiddingCountdown';
import { RoundResultModal } from './components/RoundResultModal';
import { MatchResults } from './components/MatchResults';
import { localRoundOptions } from './local/startLobbyMatch';
import { confirmRoundSkip } from './local/confirmRoundSkip';
import type { LocalMatchController } from './local/controller';

const PHASE_LABELS = {
  preparing: 'Preparing', thinking: 'Thinking', bidding: 'Bidding',
  demonstrating: 'Demonstration', 'round-result': 'Round complete', finished: 'Match finished',
};

export function App({ controller, onNewMatch }: {
  readonly controller: LocalMatchController;
  readonly onNewMatch?: () => void;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const match = snapshot.match;
  const demo = match.phase === 'demonstrating' ? match : null;
  const activeBid = demo?.bidderQueue[demo.activeBidderIndex];
  const canControl = activeBid?.seatId === snapshot.actingSeatId;
  const activeName = match.players.find((player) => player.seatId === activeBid?.seatId)?.nickname;
  const round = 'round' in match ? match.round : null;
  const canSkip = match.phase === 'thinking' && snapshot.actingSeatId === snapshot.hostSeatId;
  const selectionKey = `${match.matchId}:${round?.number}:${demo?.activeBidderIndex}`;
  const [selection, setSelection] = useState<{ key: string; robotId: RobotId } | null>(null);
  const selectedRobot = selection?.key === selectionKey ? selection.robotId
    : round?.target.kind === 'colored' ? round.target.robotId : 'red';
  function selectRobot(robotId: RobotId) {
    if (canControl) setSelection({ key: selectionKey, robotId });
  }
  function move(direction: Direction) {
    controller.sendPlayer({ type: 'attempt.move', robotId: selectedRobot, direction });
  }
  const playerSwitcher = <LocalPlayerSwitcher players={match.players} hostSeatId={snapshot.hostSeatId}
    actingSeatId={snapshot.actingSeatId} onActAs={controller.actAs} />;

  if (match.phase === 'finished') return <MatchResults
    match={match} currentSeatId={snapshot.actingSeatId} hostSeatId={snapshot.hostSeatId}
    developmentTools={playerSwitcher}
    onNewMatch={() => {
      const current = controller.getSnapshot();
      if (current.match === match && current.actingSeatId === current.hostSeatId) onNewMatch?.();
    }}
  />;

  return (
    <>
    <main className="board-preview" inert={match.phase === 'round-result'}>
      {match.phase !== 'round-result' && playerSwitcher}
      <header className="board-preview__header">
        <div>
          <p className="board-preview__eyebrow">{PHASE_LABELS[match.phase]}{round ? ` · Round ${round.number}` : ''}</p>
          <h1>{demo ? canControl ? 'Your turn' : `${activeName}'s turn` : PHASE_LABELS[match.phase]}</h1>
        </div>
        {(canSkip || match.phase === 'bidding' || demo) && (
          <div className="round-header__actions">
            {canSkip && <button className="skip-round" type="button" onClick={() => confirmRoundSkip(controller)}>Skip Round</button>}
            {match.phase === 'bidding' && <BiddingCountdown controller={controller} deadlineAtMs={match.deadlineAtMs} />}
            {demo && activeBid && (
              <p aria-label={`${demo.attempt.moves.length} of ${activeBid.value} moves used`} className="board-preview__move-count">
                <span>Moves</span><strong>{demo.attempt.moves.length} / {activeBid.value}</strong>
              </p>
            )}
          </div>
        )}
      </header>
      <div className={`demo-layout${match.phase === 'thinking' || match.phase === 'bidding' ? ' demo-layout--bidding' : ''}`}>
        <div className="board-preview__canvas">
          <BoardSvg
            board={match.puzzle.board}
            robots={demo ? demo.attempt.robots : match.officialRobots}
            targets={match.puzzle.targets}
            activeTargetId={round?.target.id ?? null}
            selectedRobot={canControl ? selectedRobot : null}
            onRobotSelect={canControl ? selectRobot : undefined}
          />
        </div>
        {demo && canControl ? (
          <DemonstrationControls
            selectedRobot={selectedRobot}
            moveCount={demo.attempt.moves.length}
            onSelect={selectRobot}
            onMove={move}
            onUndo={() => controller.sendPlayer({ type: 'attempt.undo' })}
            onReset={() => controller.sendPlayer({ type: 'attempt.reset' })}
            onGiveUp={() => controller.sendPlayer({ type: 'attempt.giveUp' })}
            feedback={snapshot.outcome?.status === 'rejected' ? `Action rejected: ${snapshot.outcome.reason}` : null}
          />
        ) : match.phase === 'thinking' || match.phase === 'bidding' ? (
          <div className="bidding-panels">
            <BidCard
              key={`${match.matchId}:${match.round.number}:${snapshot.actingSeatId}`}
              acceptedBid={match.phase === 'bidding' ? match.bids.find((bid) => bid.seatId === snapshot.actingSeatId)?.value : undefined}
              onPlaceBid={(value) => controller.sendPlayer({ type: 'bid.submit', value })}
            />
            <PlayerRoster
              variant="bids"
              players={match.players}
              bids={match.phase === 'bidding' ? match.bids : []}
              currentSeatId={snapshot.actingSeatId}
            />
          </div>
        ) : match.phase === 'preparing' ? (
          <PreparationPanel
            pending={snapshot.preparationPending}
            preparation={match.preparation}
            error={snapshot.preparationError}
            isHost={snapshot.actingSeatId === snapshot.hostSeatId}
            onRetry={() => controller.prepareRound(localRoundOptions(match.puzzle))}
          />
        ) : match.phase !== 'round-result' ? (
          <section aria-label="Phase status" className="phase-placeholder" aria-live="polite">
            {demo ? `Watching ${activeName}'s demonstration. Only the active bidder can control robots.`
              : `${PHASE_LABELS[match.phase]} screen will be added in a later T12 subtask.`}
          </section>
        ) : null}
      </div>
    </main>
    {match.phase === 'round-result' && <RoundResultModal
      key={`${match.matchId}:${match.round.number}`}
      match={match}
      isHost={snapshot.actingSeatId === snapshot.hostSeatId}
      hostName={match.players.find((player) => player.seatId === snapshot.hostSeatId)!.nickname}
      onContinue={() => { controller.continueRound(match, localRoundOptions(match.puzzle)); }}
      developmentTools={playerSwitcher}
    />}
    </>
  );
}
