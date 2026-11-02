import { DurableObject } from 'cloudflare:workers';
import { getSchemaVersion, initializeStorage } from './storageSchema';
import { initializeSessions, SessionStore } from './sessions';
import type { OpenSessionResult, VerifiedSession } from './sessions';
import { parseClientRequest, parsePublicRoomState, parseServerMessage, type RoomRequest } from '@robot-puzzle/shared';
import type { RoomTerminal } from './roomTerminal';
import {
  CreationCoordinator, CreationStore, initializeCreations,
} from './creations';
import type { CreateRequest, CreationResult } from './creations';
import { consumeBootstrapBudget } from './bootstrapBudget';
import type { MembershipRequest, MembershipResult } from './roomMembership';

/** Shared private session, room-code and creation directory. */
export class Registry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      initializeStorage(ctx.storage);
      initializeSessions(ctx.storage);
      initializeCreations(ctx.storage);
      await this.scheduleRecovery();
    });
  }

  // Binding-only read used by smoke tests; never routed from public HTTP input.
  getStorageVersion(): number | null {
    return getSchemaVersion(this.ctx.storage);
  }

  openSession(credential: string | null): Promise<OpenSessionResult> {
    return new SessionStore(this.ctx.storage).open(credential);
  }

  verifySession(credential: string): Promise<VerifiedSession | null> {
    return new SessionStore(this.ctx.storage).verify(credential);
  }

  verifySessionIdentity(sessionId: string): VerifiedSession | null {
    return new SessionStore(this.ctx.storage).byId(sessionId);
  }

  async authorizeSocket(credential: string, roomId: string) {
    const session = await new SessionStore(this.ctx.storage).verify(credential);
    if (!session) return { status: 'rejected' as const, reason: 'not-authenticated' as const };
    const destination = new CreationStore(this.ctx.storage).lookupRoom(roomId);
    if (!destination) return { status: 'rejected' as const, reason: 'room-not-found' as const };
    if (destination.status === 'closed') return { status: 'rejected' as const, reason: 'room-closed' as const };
    if (destination.status === 'expired') return { status: 'rejected' as const, reason: 'room-expired' as const };
    if (destination.status === 'pending') return { status: 'rejected' as const, reason: 'temporarily-unavailable' as const };
    return { status: 'authorized' as const, sessionId: session.sessionId };
  }

  private coordinator(store: CreationStore): CreationCoordinator {
    return new CreationCoordinator(store, async (input) => {
      using result = await this.env.ROOMS.get(this.env.ROOMS.idFromName(input.roomId)).initialize(input);
      // RPC adds a non-JSON disposer. Copy only JSON data, then apply strict parsing.
      const parsed = parsePublicRoomState(JSON.parse(JSON.stringify(result)));
      if (!parsed.ok) throw new Error('Invalid Room reply');
      return parsed.value;
    });
  }

  private async scheduleRecovery(): Promise<void> {
    const due = new CreationStore(this.ctx.storage).nextRecoveryAt();
    if (due !== null) {
      const existing = await this.ctx.storage.getAlarm();
      if (existing === null || existing > due) await this.ctx.storage.setAlarm(Math.max(Date.now(), due));
    }
  }

  async createRoom(credential: string, request: CreateRequest): Promise<CreationResult> {
    const parsed = parseClientRequest(request);
    if (!parsed.ok || parsed.value.command.type !== 'room.create') throw new Error('Invalid internal create request');
    const sessions = new SessionStore(this.ctx.storage);
    const session = await sessions.verify(credential);
    if (!session) return { status: 'rejected', reason: 'not-authenticated' };
    const store = new CreationStore(this.ctx.storage);
    const reservation = store.reserve(session.sessionId, session.expiresAt, parsed.value as CreateRequest);
    if (reservation.status === 'rejected') return reservation;
    // A persisted pending reservation exists before any external Room call.
    await this.scheduleRecovery();
    let result: CreationResult;
    try { result = await this.coordinator(store).complete(reservation); }
    catch (error) {
      const destination = store.lookupRoom(reservation.initialization.roomId);
      if (destination?.status === 'closed' || destination?.status === 'expired') return { status: 'rejected', reason: destination.status === 'expired' ? 'room-expired' : 'room-closed' };
      throw error;
    }
    // Do not disclose private membership after a session expires/revokes in flight.
    if (!await sessions.verify(credential)) return { status: 'rejected', reason: 'not-authenticated' };
    return result;
  }

  async enterRoom(credential: string, request: MembershipRequest): Promise<MembershipResult> {
    const parsed = parseClientRequest(request);
    if (!parsed.ok || (parsed.value.command.type !== 'room.join' && parsed.value.command.type !== 'session.resume')) {
      throw new Error('Invalid internal membership request');
    }
    const input = parsed.value as MembershipRequest;
    const sessions = new SessionStore(this.ctx.storage);
    const session = await sessions.verify(credential);
    if (!session) return { status: 'rejected', reason: 'not-authenticated' };
    if (!this.ctx.storage.transactionSync(() => consumeBootstrapBudget(this.ctx.storage, session.sessionId, false, Date.now()))) {
      return { status: 'rejected', reason: 'rate-limited' };
    }
    const creations = new CreationStore(this.ctx.storage);
    const destination = input.command.type === 'room.join'
      ? creations.lookup(input.command.roomCode) : creations.lookupRoom(input.command.roomId);
    if (!destination) return { status: 'rejected', reason: 'room-not-found' };
    if (destination.status === 'closed') return { status: 'rejected', reason: 'room-closed' };
    if (destination.status === 'expired') return { status: 'rejected', reason: 'room-expired' };
    if (destination.status === 'pending') return { status: 'rejected', reason: 'temporarily-unavailable' };
    const roomId = destination.roomId;
    using result = await this.env.ROOMS.get(this.env.ROOMS.idFromName(roomId)).enter(session, input);
    if (!await sessions.verify(credential)) return { status: 'rejected', reason: 'not-authenticated' };
    if (result.status === 'rejected') return { status: 'rejected', reason: result.reason };
    const state = parsePublicRoomState(result.state);
    if (!state.ok || state.value.roomId !== roomId || !state.value.players.some((p) => p.seatId === result.seatId)) {
      throw new Error('Invalid Room membership reply');
    }
    return { status: 'entered', membership: result.membership, seatId: result.seatId, state: state.value };
  }

  /** Binding-only terminal outbox target; never a public routing command. */
  async closeRoomDirectory(p: RoomTerminal, redact: boolean): Promise<void> {
    if (!parseServerMessage({ version: 2, type: 'room.closed', roomId: p.roomId, lastRevision: p.lastRevision, reason: p.reason, serverTimeMs: p.closedAtMs }).ok
      || (p.reason !== 'host-ended' && p.reason !== 'expired') || p.version !== 1 || p.cleanupAtMs !== p.closedAtMs + 86400000
      || !parseClientRequest({ version: 2, commandId: p.closureId, command: { type: 'session.open' } }).ok
      || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(p.roomCode) || typeof redact !== 'boolean') throw new Error('Invalid closure intent');
    new CreationStore(this.ctx.storage).closeDirectory(p, redact);
    await this.scheduleRecovery();
  }

  async roomReceipt(credential: string, request: RoomRequest) {
    const parsed = parseClientRequest(request);
    if (!parsed.ok || !('roomId' in parsed.value)) throw new Error('Invalid receipt request');
    const sessions = new SessionStore(this.ctx.storage); const session = await sessions.verify(credential);
    if (!session) return { status: 'rejected' as const, reason: 'not-authenticated' as const };
    if (!this.ctx.storage.transactionSync(() => consumeBootstrapBudget(this.ctx.storage, session.sessionId, false, Date.now()))) return { status: 'rejected' as const, reason: 'rate-limited' as const };
    using result = await this.env.ROOMS.get(this.env.ROOMS.idFromName(request.roomId)).readReceipt(session, request);
    if (!await sessions.verify(credential)) return { status: 'rejected' as const, reason: 'not-authenticated' as const };
    if (result.status === 'rejected') return { status: 'rejected' as const, reason: result.reason };
    return { status: 'receipt' as const, result: { outcome: result.result.outcome,
      processedRevision: result.result.processedRevision, currentRevision: result.result.currentRevision,
      duplicate: result.result.duplicate, changed: false } };
  }

  async alarm(): Promise<void> {
    const store = new CreationStore(this.ctx.storage);
    for (const reservation of store.pending()) {
      try { await this.coordinator(store).complete(reservation); }
      catch { store.defer(reservation.initialization); }
    }
    await this.scheduleRecovery();
  }
}
