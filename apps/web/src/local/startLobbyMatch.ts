import { createMatch, type MatchPlayer, type RoundPreparationOptions } from '@robot-puzzle/match';
import { type PuzzleBoard } from '@robot-puzzle/puzzles';
import { RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import { createLocalMatchController, type LocalMatchController } from './controller';

export function localRoundOptions(puzzle: PuzzleBoard): RoundPreparationOptions {
  return { candidateOrder: puzzle.targets.map((target) => target.id), budget: RECOMMENDED_ROUND_SETUP_BUDGET };
}

/** One-shot local lobby start. Creating this guard does not create a match/search. */
export function createLobbyMatchStarter(options: {
  readonly players: readonly MatchPlayer[];
  readonly hostSeatId: string;
  readonly now: () => number;
  readonly schedulePreparation?: (work: () => void) => void;
}) {
  let started: LocalMatchController | null = null;
  let matchNumber = 0;
  return {
    returnToLobby(expected: LocalMatchController): boolean {
      const snapshot = expected.getSnapshot();
      if (started !== expected || snapshot.match.phase !== 'finished' ||
        snapshot.actingSeatId !== snapshot.hostSeatId) return false;
      started = null;
      return true;
    },
    start(puzzle: PuzzleBoard, actorSeatId: string): LocalMatchController | null {
      if (started || actorSeatId !== options.hostSeatId) return null;
      matchNumber += 1;
      const match = createMatch({ matchId: matchNumber === 1 ? 'local-match' : `local-match-${matchNumber}`, players: options.players, puzzle });
      started = createLocalMatchController({
        match, actingSeatId: actorSeatId, hostSeatId: options.hostSeatId,
        now: options.now, schedulePreparation: options.schedulePreparation,
      });
      // Lock before starting work: repeated clicks cannot create/prepare another match.
      started.prepareRound(localRoundOptions(match.puzzle));
      return started;
    },
  };
}
