// Isolated restart harness only. No production route or binding references it.
import { Room as RoomBase } from '../src/room';
import { createMatch } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
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
        if (mode === 'thinking' || mode === 'bidding' || mode === 'overdue-bidding') await runPreparationAlarm(this.ctx.storage, match.job.dueAtMs);
        if (mode === 'bidding' || mode === 'overdue-bidding') {
          const room = storedRoom(this.ctx.storage)!;
          executeLobbyCommand(this.ctx.storage, 'host', players[0].seatId, { version: 1, roomId: room.state.roomId,
            commandId: crypto.randomUUID(), context: { matchId: state.matchId, roundNumber: 1 }, command: { type: 'bid.submit', value: 7 } },
            undefined, undefined, () => mode === 'overdue-bidding' ? Date.now() - 120000 : match.job!.dueAtMs);
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
      // Leave an overdue test record dormant until full runtime recreation so the
      // real Room constructor, not a request-side test helper, must normalize it.
      if (!(url.pathname === '/seed' && url.searchParams.get('mode') === 'overdue-bidding')) await live.publish(false);
      if (url.pathname === '/forget-alarm') await this.ctx.storage.deleteAlarm();
      return Response.json({ room: storedRoom(this.ctx.storage), alarm: await this.ctx.storage.getAlarm() });
    });
  }
}

export default {
  fetch(request: Request, env: Env) {
    return env.ROOMS.get(env.ROOMS.idFromName('preparation-restart')).fetch(request);
  },
};
