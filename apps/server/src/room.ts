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
import { PresenceStore } from './presence';
import { expireEmptyRoom, initializeRoomTerminal, terminalRoom } from './roomTerminal';
import { readLobbyReceipt } from './lobbyCommands';
import type { RoomRequest } from '@robot-puzzle/shared';

/** Persistent membership, match creation and bounded scheduled preparation. */
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
      initializeRoomTerminal(ctx.storage);
      new PresenceStore(ctx.storage).initialize();
      if (terminalRoom(ctx.storage) || storedRoom(ctx.storage)) await this.live.publish(false);
    });
  }

  getStorageVersion(): number | null {
    return getSchemaVersion(this.ctx.storage);
  }

  enter(session: VerifiedSession, request: MembershipRequest): Promise<MembershipResult> {
    return this.live.run(async () => {
      await this.live.publish(false);
      const result = new MembershipStore(this.ctx.storage).enter(session, request);
      await this.live.publish(result.status === 'entered' && result.membership === 'joined');
      const terminal = terminalRoom(this.ctx.storage);
      if (terminal) return { status: 'rejected', reason: terminal.reason === 'expired' ? 'room-expired' : 'room-closed' };
      return result.status === 'entered' ? { ...result, state: storedRoom(this.ctx.storage)!.state } : result;
    });
  }

  async initialize(input: RoomInitialization): Promise<PublicRoomState> {
    return this.live.run(async () => {
      if (storedRoom(this.ctx.storage)) await this.live.publish(false);
      const existing = storedRoom(this.ctx.storage);
      if (existing && expireEmptyRoom(this.ctx.storage, existing, Date.now())) {
        await this.live.publish(false); throw new Error('Room is closed');
      }
      this.initializeStored(input);
      // Includes never-opened rooms; repeated initialization preserves the deadline.
      await this.live.publish(false);
      if (terminalRoom(this.ctx.storage)) throw new Error('Room is closed');
      return storedRoom(this.ctx.storage)!.state;
    });
  }

  private initializeStored(input: RoomInitialization): PublicRoomState {
    if (terminalRoom(this.ctx.storage)) throw new Error('Room is closed');
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

  readReceipt(session: VerifiedSession, input: RoomRequest) {
    return this.live.run(async () => {
      await this.live.publish(false);
      const room = storedRoom(this.ctx.storage);
      if (Date.now() < session.issuedAt || Date.now() >= session.expiresAt) return { status: 'rejected' as const, reason: 'not-authenticated' as const };
      if (!room || room.state.roomId !== input.roomId || !room.members[session.sessionId]) return { status: 'rejected' as const, reason: 'seat-not-found' as const };
      return { status: 'receipt' as const, result: readLobbyReceipt(this.ctx.storage, session.sessionId, input) };
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
  alarm(): Promise<void> { return this.live.run(() => this.live.alarm()); }
}
