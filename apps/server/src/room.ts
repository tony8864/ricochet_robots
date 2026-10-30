import { DurableObject } from 'cloudflare:workers';
import { getSchemaVersion, initializeStorage } from './storageSchema';
import { projectLobbyState } from '@robot-puzzle/shared';
import type { PublicRoomState } from '@robot-puzzle/shared';
import { canonicalJson } from './creations';
import type { RoomInitialization } from './creations';
import { initializeMemberships, MembershipStore, validateStoredRoom } from './roomMembership';
import type { MembershipRequest, MembershipResult, StoredRoom } from './roomMembership';
import type { VerifiedSession } from './sessions';
import { LiveLobby } from './liveLobby';
import { initializeSocketStorage, storedRoom } from './lobbyCommands';

/** Persistent membership and initial match creation. Target preparation/gameplay arrive later. */
export class Room extends DurableObject<Env> {
  private readonly live: LiveLobby;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.live = new LiveLobby(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      initializeStorage(ctx.storage);
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS room_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1), value TEXT NOT NULL
      )`);
      initializeMemberships(ctx.storage);
      initializeSocketStorage(ctx.storage);
      if (storedRoom(ctx.storage)) await this.live.publish(false);
    });
  }

  getStorageVersion(): number | null {
    return getSchemaVersion(this.ctx.storage);
  }

  enter(session: VerifiedSession, request: MembershipRequest): Promise<MembershipResult> {
    return this.live.run(async () => {
      const result = new MembershipStore(this.ctx.storage).enter(session, request);
      await this.live.publish(result.status === 'entered' && result.membership === 'joined');
      return result.status === 'entered' ? { ...result, state: storedRoom(this.ctx.storage)!.state } : result;
    });
  }

  async initialize(input: RoomInitialization): Promise<PublicRoomState> {
    return this.live.run(async () => this.initializeStored(input));
  }

  private initializeStored(input: RoomInitialization): PublicRoomState {
    if (this.ctx.id.toString() !== this.env.ROOMS.idFromName(input.roomId).toString()) {
      throw new Error('Room identity mismatch');
    }
    const initialization = canonicalJson(input);
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM room_state WHERE singleton = 1').toArray()[0];
      const existing = row ? validateStoredRoom(JSON.parse(row.value) as StoredRoom) : null;
      if (existing) {
        if (existing.initialization !== initialization || existing.members[input.sessionId] !== input.hostSeatId) {
          throw new Error('Room initialization conflict');
        }
        return existing.state;
      }
      const projected = projectLobbyState({
        roomId: input.roomId, roomCode: input.roomCode, revision: 1,
        hostSeatId: input.hostSeatId, lobbyId: input.lobbyId, puzzle: input.puzzle,
        players: [{ seatId: input.hostSeatId, nickname: input.nickname, connected: false }],
      });
      if (!projected.ok) throw new Error('Invalid initial lobby');
      const saved: StoredRoom = {
        initialization, members: { [input.sessionId]: input.hostSeatId }, state: projected.value,
      };
      this.ctx.storage.sql.exec('INSERT INTO room_state VALUES (1, ?)', JSON.stringify(saved));
      return projected.value;
    });
  }

  fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/socket' || request.method !== 'GET'
      || request.headers.get('Upgrade') !== 'websocket') return Promise.resolve(new Response(null, { status: 404 }));
    // Only Worker-created binding requests can reach this handler. Public headers
    // are discarded by socketRoute before this private hop.
    const sessionId = request.headers.get('X-RR-Session');
    const roomId = request.headers.get('X-RR-Room');
    if (!sessionId || !roomId) return Promise.resolve(new Response(null, { status: 401 }));
    return this.live.run(() => this.live.connect(sessionId, roomId));
  }
  webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    return this.live.run(() => this.live.message(ws, data));
  }
  webSocketClose(ws: WebSocket, code: number): Promise<void> {
    return this.live.run(() => this.live.closed(ws, code));
  }
  webSocketError(ws: WebSocket): Promise<void> {
    return this.live.run(() => this.live.closed(ws, 1001));
  }
  alarm(): Promise<void> { return this.live.run(() => this.live.publish(false)); }
}
