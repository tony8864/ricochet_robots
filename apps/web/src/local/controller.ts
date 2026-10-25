import {
  transitionMatch,
  prepareMatchRound,
  type MatchCommandOutcome,
  type MatchState,
  type PlayerMatchCommand,
  type RoundPreparationOptions,
} from '@robot-puzzle/match';

export interface LocalMatchSnapshot {
  readonly match: MatchState;
  readonly actingSeatId: string;
  readonly hostSeatId: string;
  readonly outcome: MatchCommandOutcome | null;
  readonly preparationPending: boolean;
  readonly preparationError: string | null;
}

export interface LocalMatchController {
  readonly getSnapshot: () => LocalMatchSnapshot;
  readonly getNow: () => number;
  readonly subscribe: (listener: () => void) => () => void;
  readonly actAs: (seatId: string) => void;
  readonly sendPlayer: (command: PlayerMatchCommand) => MatchCommandOutcome;
  readonly advanceTime: () => MatchCommandOutcome;
  readonly prepareRound: (options: RoundPreparationOptions) => boolean;
  readonly continueRound: (expectedResult: MatchState, options: RoundPreparationOptions) => boolean;
}

/** Single local authority for the prototype, not an authenticated server. */
export function createLocalMatchController(options: {
  readonly match: MatchState;
  readonly hostSeatId: string;
  readonly actingSeatId: string;
  readonly now: () => number;
  readonly schedulePreparation?: (work: () => void) => void;
}): LocalMatchController {
  const hasSeat = (seatId: string) => options.match.players.some((player) => player.seatId === seatId);
  if (!hasSeat(options.hostSeatId) || !hasSeat(options.actingSeatId)) {
    throw new TypeError('Local host and acting seat must belong to the match roster.');
  }
  let snapshot: LocalMatchSnapshot = {
    match: options.match, hostSeatId: options.hostSeatId, actingSeatId: options.actingSeatId, outcome: null,
    preparationPending: false, preparationError: null,
  };
  const listeners = new Set<() => void>();
  function publish(next: LocalMatchSnapshot) {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }
  function apply(action: Parameters<typeof transitionMatch>[1]) {
    const result = transitionMatch(snapshot.match, action);
    // A rejection can still carry independently due bidding expiry.
    publish({ ...snapshot, match: result.state, outcome: result.outcome });
    return result.outcome;
  }
  const controller: LocalMatchController = {
    getSnapshot: () => snapshot,
    getNow: options.now,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    actAs(seatId) {
      if (!hasSeat(seatId)) throw new TypeError('Unknown local player seat.');
      if (seatId !== snapshot.actingSeatId) publish({ ...snapshot, actingSeatId: seatId, outcome: null });
    },
    sendPlayer(command) {
      return apply({
        source: 'player', command,
        context: { actorSeatId: snapshot.actingSeatId, hostSeatId: snapshot.hostSeatId, nowMs: options.now() },
      });
    },
    advanceTime() {
      return apply({ source: 'controller', command: { type: 'time.advance' }, context: { nowMs: options.now() } });
    },
    continueRound(expectedResult, preparationOptions) {
      // Bind the request to the displayed result, not whichever round is current later.
      if (snapshot.actingSeatId !== snapshot.hostSeatId || snapshot.match !== expectedResult ||
        snapshot.match.phase !== 'round-result') return false;
      const outcome = apply({ source: 'controller', command: { type: 'round.advance' }, context: { nowMs: options.now() } });
      if (outcome.status !== 'accepted') return false;
      if (controller.getSnapshot().match.phase === 'preparing') controller.prepareRound(preparationOptions);
      return true;
    },
    prepareRound(preparationOptions) {
      if (snapshot.match.phase !== 'preparing' || snapshot.preparationPending ||
        snapshot.actingSeatId !== snapshot.hostSeatId) return false;
      const pendingMatch = snapshot.match;
      const config: RoundPreparationOptions = {
        candidateOrder: [...preparationOptions.candidateOrder],
        budget: { ...preparationOptions.budget, perCandidate: { ...preparationOptions.budget.perCandidate } },
      };
      publish({ ...snapshot, preparationPending: true, preparationError: null, outcome: null });
      const failed = () => publish({
        ...snapshot, preparationPending: false,
        preparationError: 'Target preparation could not complete. Please retry.',
      });
      try {
        // Yield to let React display Preparing before the bounded synchronous search.
        const schedule = options.schedulePreparation ?? ((work: () => void) => { setTimeout(work, 0); });
        schedule(() => {
          if (snapshot.match !== pendingMatch) {
            publish({ ...snapshot, preparationPending: false });
            return;
          }
          try {
            const result = prepareMatchRound(pendingMatch, config);
            publish({ ...snapshot, match: result.state, outcome: result.outcome, preparationPending: false, preparationError: null });
          } catch {
            failed();
          }
        });
      } catch {
        failed();
      }
      return true;
    },
  };
  return controller;
}
