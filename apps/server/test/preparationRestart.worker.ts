// Isolated restart harness only. No production route or binding references it.
import { Room as RoomBase } from '../src/room';
import { createMatch, transitionMatch } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import { projectLobbyState } from '@robot-puzzle/shared';
import { executeLobbyCommand, expireBidding, saveRoom, storedRoom } from '../src/lobbyCommands';
import { queuedPreparation, runPreparationAlarm } from '../src/roomPreparation';
import { projectStoredMatch } from '../src/storedMatch';
import { PREPARATION_RECOVERY_MS } from '../src/preparationJob';
import type { LiveLobby } from '../src/liveLobby';

export class Room extends RoomBase {
  fetch(request: Request): Promise<Response> {
    const live = (this as unknown as { live: LiveLobby }).live;
    return live.run(async () => {
      const url = new URL(request.url);
      if (url.pathname === '/seed') {
        const players = [{ seatId: crypto.randomUUID(), nickname: 'Host', connected: false }, { seatId: crypto.randomUUID(), nickname: 'Guest', connected: false }];
        const lobby = projectLobbyState({ roomId: crypto.randomUUID(), roomCode: 'ABC234', revision: 1,
          hostSeatId: players[0].seatId, lobbyId: crypto.randomUUID(), puzzle: starterBoard, players });
        if (!lobby.ok) throw new Error('Invalid test lobby');
        const state = createMatch({ matchId: crypto.randomUUID(), puzzle: starterBoard, players });
        // Future due time prevents real-time races; /advance supplies controlled time.
        const match = queuedPreparation(state, Date.now() + 60_000);
        const members = { host: players[0].seatId, guest: players[1].seatId };
        this.ctx.storage.sql.exec('INSERT INTO room_state VALUES (1, ?)', JSON.stringify({
          initialization: '{}', members, state: lobby.value,
        }));
        saveRoom(this.ctx.storage, { initialization: '{}', members, match, state: projectStoredMatch(lobby.value, match) });
        const mode = url.searchParams.get('mode');
        if (match.version !== 2 || !match.job) throw new Error('Missing job');
        if (mode === 'error') await runPreparationAlarm(this.ctx.storage, match.job.dueAtMs, () => { throw new Error('private failure'); });
        const attemptMode = mode === 'attempt' || mode === 'undo' || mode === 'success' || mode === 'later-bidder' || mode === 'round-result' || mode === 'continued' || mode === 'finished' || mode === 'returned-lobby';
        if (mode === 'thinking' || mode === 'bidding' || mode === 'overdue-bidding' || attemptMode) await runPreparationAlarm(this.ctx.storage, match.job.dueAtMs);
        if (mode === 'bidding' || mode === 'overdue-bidding' || attemptMode) {
          const room = storedRoom(this.ctx.storage)!;
          executeLobbyCommand(this.ctx.storage, 'host', players[0].seatId, { version: 1, roomId: room.state.roomId,
            commandId: crypto.randomUUID(), context: { matchId: state.matchId, roundNumber: 1 }, command: { type: 'bid.submit', value: mode === 'success' ? 100 : 7 } },
            undefined, undefined, () => mode === 'overdue-bidding' ? Date.now() - 120000 : match.job!.dueAtMs);
          if (attemptMode) {
            executeLobbyCommand(this.ctx.storage, 'guest', players[1].seatId, { version: 1, roomId: room.state.roomId,
              commandId: crypto.randomUUID(), context: { matchId: state.matchId, roundNumber: 1 }, command: { type: 'bid.submit', value: mode === 'success' ? 101 : 8 } },
              undefined, undefined, () => match.job!.dueAtMs);
            expireBidding(this.ctx.storage, match.job!.dueAtMs + 60000);
            const apply = (command: import('@robot-puzzle/match').AttemptMatchCommand, seat = 0) => {
              const current = storedRoom(this.ctx.storage)!;
              if (current.state.status !== 'playing' || current.state.match.phase !== 'demonstrating') throw new Error('Expected demo');
              const demo = current.state.match;
              const request = { version: 1 as const, commandId: crypto.randomUUID(), roomId: room.state.roomId,
                context: { matchId: state.matchId, roundNumber: 1 as const, attemptId: demo.attempt.id, attemptVersion: demo.attempt.version }, command };
              return executeLobbyCommand(this.ctx.storage, seat ? 'guest' : 'host', players[seat].seatId, request as import('@robot-puzzle/shared').RoomRequest, undefined, undefined, () => match.job!.dueAtMs + 60001);
            };
            if (mode === 'success') {
              const demo = storedRoom(this.ctx.storage)!.match!.state;
              if (demo.phase !== 'demonstrating') throw new Error('Expected demo');
              // Seed only: obtain a proof for the already-verified target, then
              // exercise real commands. Restore/replay never invokes this search.
              const selected = prepareNextRound({ puzzle: demo.puzzle, robots: demo.round.startRobots, usedTargetIds: [],
                candidateOrder: [demo.round.target.id, ...demo.puzzle.targets.filter((t) => t.id !== demo.round.target.id).map((t) => t.id)], budget: RECOMMENDED_ROUND_SETUP_BUDGET });
              if (selected.status !== 'selected' || selected.round.target.id !== demo.round.target.id || selected.internalProof.length > demo.bidderQueue[0].value) throw new Error('Missing short fixture proof');
              for (const move of selected.internalProof) apply({ type: 'attempt.move', ...move });
            } else if (mode === 'attempt' || mode === 'undo') {
              const demo = storedRoom(this.ctx.storage)!.match!.state;
              let move: import('@robot-puzzle/match').AttemptMatchCommand | undefined;
              for (const robotId of ['red', 'blue', 'green', 'yellow'] as const) for (const direction of ['up', 'right', 'down', 'left'] as const) {
                const command = { type: 'attempt.move' as const, robotId, direction };
                const result = transitionMatch(demo, { source: 'player', context: { actorSeatId: players[0].seatId, hostSeatId: players[0].seatId, nowMs: 0 }, command });
                if (result.outcome.status === 'accepted' && result.state.phase === 'demonstrating') move = command;
              }
              if (!move) throw new Error('Missing nonwinning move');
              apply(move); apply({ type: mode === 'undo' ? 'attempt.undo' : 'attempt.reset' }); apply(move);
            } else {
              apply({ type: 'attempt.giveUp' });
              if (mode === 'round-result' || mode === 'continued' || mode === 'finished' || mode === 'returned-lobby') apply({ type: 'attempt.giveUp' }, 1);
              if (mode === 'continued' || mode === 'finished' || mode === 'returned-lobby') {
                let result = storedRoom(this.ctx.storage)!;
                if (result.match?.state.phase !== 'round-result') throw new Error('Expected result');
                if (mode === 'finished' || mode === 'returned-lobby') {
                  // Isolated valid round-10 fixture, not a simulation of prior rounds.
                  const final = { ...result.match.state, completedRounds: 10 as const, round: { ...result.match.state.round, number: 10 as const },
                    usedTargetIds: [...starterBoard.targets.filter((t) => t.id !== result.match!.state.usedTargetIds[0]).slice(0, 9).map((t) => t.id), result.match.state.round.target.id] };
                  const record = { version: 4 as const, state: final };
                  saveRoom(this.ctx.storage, { ...result, match: record, state: projectStoredMatch(result.state, record) });
                  result = storedRoom(this.ctx.storage)!;
                }
                executeLobbyCommand(this.ctx.storage, 'host', players[0].seatId, { version: 1, commandId: crypto.randomUUID(), roomId: result.state.roomId,
                  context: { matchId: state.matchId, roundNumber: mode === 'continued' ? 1 : 10 }, command: { type: 'round.continue' } },
                  undefined, undefined, () => match.job!.dueAtMs + 60001);
                if (mode === 'returned-lobby') executeLobbyCommand(this.ctx.storage, 'host', players[0].seatId,
                  { version: 1, commandId: crypto.randomUUID(), roomId: result.state.roomId, context: { matchId: state.matchId }, command: { type: 'match.returnToLobby' } },
                  undefined, undefined, () => match.job!.dueAtMs + 60002);
              }
            }
          }
        }
        if (mode === 'running') {
          const room = storedRoom(this.ctx.storage)!;
          saveRoom(this.ctx.storage, { ...room, match: { ...match, job: {
            ...match.job, status: 'running', dueAtMs: match.job.dueAtMs + PREPARATION_RECOVERY_MS,
          } } });
        }
      }
      if (url.pathname === '/advance') {
        const saved = storedRoom(this.ctx.storage)!;
        const match = saved.match;
        if (match?.version === 2 && match.job) await runPreparationAlarm(this.ctx.storage, match.job.dueAtMs);
        if (match?.state.phase === 'bidding') expireBidding(this.ctx.storage, match.state.deadlineAtMs);
      }
      let replay;
      if (url.pathname === '/replay-attempt') {
        const saved = storedRoom(this.ctx.storage)!;
        const row = this.ctx.storage.sql.exec<{ session_id: string; request_json: string }>(
          "SELECT session_id, request_json FROM membership_replays WHERE request_json LIKE '%attempt.%' AND outcome_json LIKE '%accepted%' ORDER BY processed_revision DESC LIMIT 1").toArray()[0];
        if (!row) throw new Error('Missing persisted attempt outcome');
        replay = executeLobbyCommand(this.ctx.storage, row.session_id, saved.members[row.session_id], JSON.parse(row.request_json));
      }
      // Leave an overdue test record dormant until full runtime recreation so the
      // real Room constructor, not a request-side test helper, must normalize it.
      if (!(url.pathname === '/seed' && url.searchParams.get('mode') === 'overdue-bidding')) await live.publish(false);
      if (url.pathname === '/forget-alarm') await this.ctx.storage.deleteAlarm();
      const replays = this.ctx.storage.sql.exec<{ session_id: string; command_id: string; request_json: string; outcome_json: string; processed_revision: number }>(
        'SELECT * FROM membership_replays ORDER BY session_id, command_id').toArray();
      return Response.json({ room: storedRoom(this.ctx.storage), alarm: await this.ctx.storage.getAlarm(), replays, ...(replay ? { replay } : {}) });
    });
  }
}

export default {
  fetch(request: Request, env: Env) {
    return env.ROOMS.get(env.ROOMS.idFromName('preparation-restart')).fetch(request);
  },
};
