import { DIRECTIONS, ROBOT_IDS } from '@robot-puzzle/game-engine';
import type { MatchAction, MatchTransitionResult } from './commands';
import { advanceRound, skipRound } from './advancement';
import { submitBid } from './bidding';
import { normalizeBiddingDeadline } from './deadline';
import { abandonAttempt, handleAttemptCommand } from './demonstration';
import type { MatchState } from './model';
import { acceptRoundPreparation } from './preparation';
import { accepted, noOp, rejected } from './results';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Recognize command/source shapes before applying the trusted context. */
function supportedAction(value: unknown): value is MatchAction {
  if (!isRecord(value) || !isRecord(value.command)) return false;
  if (value.source === 'player') {
    const command = value.command;
    if (command.type === 'round.skip') return typeof command.confirmed === 'boolean';
    if (command.type === 'attempt.move') {
      return ROBOT_IDS.some((id) => id === command.robotId) && DIRECTIONS.some((direction) => direction === command.direction);
    }
    return command.type === 'bid.submit' || command.type === 'attempt.undo' ||
      command.type === 'attempt.reset' || command.type === 'attempt.giveUp';
  }
  if (value.source !== 'controller') return false;
  return value.command.type === 'time.advance' || value.command.type === 'round.advance' || value.command.type === 'attempt.abandon' || (value.command.type === 'round.prepared' &&
    isRecord(value.command.request) && isRecord(value.command.result));
}

function validContext(state: MatchState, action: MatchAction): boolean {
  if (!isRecord(action.context) || !Number.isSafeInteger(action.context.nowMs) || action.context.nowMs < 0) return false;
  if (action.source === 'controller') return true;
  const { actorSeatId, hostSeatId } = action.context;
  return typeof actorSeatId === 'string' && actorSeatId.trim().length > 0 &&
    typeof hostSeatId === 'string' && state.players.some((player) => player.seatId === hostSeatId);
}

/** Pure full-lifecycle reducer; time, authorization context, and preparation are caller-owned. */
export function transitionMatch(state: MatchState, action: MatchAction): MatchTransitionResult {
  if (!supportedAction(action)) return rejected(state, 'invalid-command');
  if (!validContext(state, action)) return rejected(state, 'invalid-context');

  // Keep the normalized state even when a command below is rejected (late bids,
  // unknown actors, or internal preparation arriving after bidding closed).
  const normalized = normalizeBiddingDeadline(state, action.context.nowMs);
  if (action.source === 'player') {
    if (normalized.phase === 'finished') return rejected(normalized, 'match-finished');
    if (!normalized.players.some((player) => player.seatId === action.context.actorSeatId)) return rejected(normalized, 'unknown-player');
    if (action.command.type === 'bid.submit') {
      return submitBid(normalized, action.context.actorSeatId, action.command.value, action.context.nowMs);
    }
    if (action.command.type === 'round.skip') return skipRound(normalized, action.context, action.command.confirmed);
    return handleAttemptCommand(normalized, action.context.actorSeatId, action.command);
  }
  if (action.command.type === 'time.advance') {
    if (normalized !== state) return accepted(normalized);
    return noOp(normalized, normalized.phase === 'bidding' ? 'deadline-not-due' : 'no-active-deadline');
  }
  if (action.command.type === 'round.advance') return advanceRound(normalized);
  if (action.command.type === 'attempt.abandon') return abandonAttempt(normalized);
  return acceptRoundPreparation(normalized, action.command.request, action.command.result);
}
