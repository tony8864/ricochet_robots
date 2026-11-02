import { createAttempt, getAttemptMoveCount, isTargetComplete, moveAttemptRobot, resetAttempt, undoAttempt } from '@robot-puzzle/game-engine';
import type { AttemptMatchCommand, MatchTransitionResult } from './commands';
import { completeRound } from './completion';
import { copyRobots } from './data';
import type { MatchState, SeatId } from './model';
import { accepted, noOp, rejected } from './results';

/** Uses the shared reducer's validated actor/context and already normalized deadline. */
export function handleAttemptCommand(state: MatchState, seatId: SeatId, command: AttemptMatchCommand): MatchTransitionResult {
  if (state.phase !== 'demonstrating') return rejected(state, state.phase === 'finished' ? 'match-finished' : 'wrong-phase');
  const bidder = state.bidderQueue[state.activeBidderIndex];
  if (!bidder) throw new TypeError('Invalid demonstration state: missing active bidder.');
  if (bidder.seatId !== seatId) return rejected(state, 'not-active-bidder');

  switch (command.type) {
    case 'attempt.move': {
      const moved = moveAttemptRobot(state.puzzle.board, state.attempt, command.robotId, command.direction);
      if (!moved.moved) return noOp(state, 'blocked-move');
      const moveCount = getAttemptMoveCount(moved.attempt);
      if (moveCount > bidder.value) return rejected(state, 'bid-limit');
      if (isTargetComplete(moved.attempt.robots, state.round.target)) {
        return accepted(completeRound(state, {
          outcome: { kind: 'success', winnerSeatId: bidder.seatId, winningBid: bidder.value, moveCount },
          finalRobots: moved.attempt.robots,
        }));
      }
      return accepted({ ...state, attempt: moved.attempt });
    }
    case 'attempt.undo': {
      const attempt = undoAttempt(state.attempt);
      return attempt === state.attempt ? noOp(state, 'empty-undo') : accepted({ ...state, attempt });
    }
    case 'attempt.reset': {
      const attempt = resetAttempt(state.attempt);
      return attempt === state.attempt ? noOp(state, 'already-reset') : accepted({ ...state, attempt });
    }
    case 'attempt.giveUp': {
      return abandonAttempt(state);
    }
  }
}

/** Internal failure path shared by voluntary Give Up and authorized abandonment. */
export function abandonAttempt(state: MatchState): MatchTransitionResult {
  if (state.phase !== 'demonstrating') return rejected(state, 'wrong-phase');
  const activeBidderIndex = state.activeBidderIndex + 1;
  if (activeBidderIndex === state.bidderQueue.length) return accepted(completeRound(state, { outcome: { kind: 'all-bidders-gave-up' } }));
  return accepted({ ...state, activeBidderIndex, attempt: createAttempt(copyRobots(state.round.startRobots)) });
}
