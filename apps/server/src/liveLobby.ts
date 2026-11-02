import {
  MAX_CLIENT_MESSAGE_BYTES, MAX_SERVER_MESSAGE_BYTES, PROTOCOL_VERSION,
  parseSocketMessageJson, parsePublicServerMessage,
} from '@robot-puzzle/shared';
import type { PrivateServerMessage, PublicServerMessage, RoomRequest } from '@robot-puzzle/shared';
import { consumeSocketBudget, executeLobbyCommand, expireBidding, storedRoom } from './lobbyCommands';
import { ensurePreparationJob, runPreparationAlarm } from './roomPreparation';
import { preparationDue } from './preparationJob';
import { PresenceStore } from './presence';
import { flushRoomTerminal, terminalDue, terminalRoom } from './roomTerminal';
import { emptyRoomTimeout } from './emptyRoomPolicy';

interface SocketBinding {
  readonly version: 2;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly seatId: string;
  readonly roomId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** Private transport controller; never exposed through a public/debug route. */
export class LiveLobby {
  private tail: Promise<unknown> = Promise.resolve();
  private deadlineChanged = false;
  private readonly emptyTimeoutMs: number;
  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) { this.emptyTimeoutMs = emptyRoomTimeout(env); }

  // Awaited Registry checks must not let Room events publish out-of-order state.
  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }
  idle(): Promise<unknown> { return this.tail; }

  private binding(ws: WebSocket): SocketBinding | null {
    const value = ws.deserializeAttachment() as Partial<SocketBinding> | null;
    if (!value || value.version !== 2 || typeof value.connectionId !== 'string' || typeof value.sessionId !== 'string' || typeof value.seatId !== 'string'
      || typeof value.roomId !== 'string' || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)) return null;
    return value as SocketBinding;
  }
  private drop(ws: WebSocket, code: number): void {
    ws.serializeAttachment(null);
    try { ws.close(code, code === 1008 ? 'Session unavailable' : 'Connection closed'); } catch { /* already closed */ }
  }
  private async authorized(ws: WebSocket): Promise<SocketBinding | null> {
    const binding = this.binding(ws);
    if (ws.readyState !== WebSocket.OPEN) return null;
    if (!binding) { this.drop(ws, 1002); return null; }
    if (Date.now() < binding.issuedAt || Date.now() >= binding.expiresAt) { this.drop(ws, 1008); return null; }
    const lease = new PresenceStore(this.ctx.storage).live(binding.connectionId, Date.now());
    if (!lease || lease.session_id !== binding.sessionId || lease.seat_id !== binding.seatId
      || lease.issued_at !== binding.issuedAt || lease.identity_expires_at !== binding.expiresAt) { this.drop(ws, 1001); return null; }
    const saved = storedRoom(this.ctx.storage);
    if (!saved || saved.state.roomId !== binding.roomId || saved.members[binding.sessionId] !== binding.seatId
      || !saved.state.players.some((p) => p.seatId === binding.seatId)) { this.drop(ws, 1008); return null; }
    try {
      using current = await this.env.REGISTRY.get(this.env.REGISTRY.idFromName('registry-v1')).verifySessionIdentity(binding.sessionId);
      if (!current || current.issuedAt !== binding.issuedAt || current.expiresAt !== binding.expiresAt
        || Date.now() >= current.expiresAt) { this.drop(ws, 1008); return null; }
      if (!new PresenceStore(this.ctx.storage).live(binding.connectionId, Date.now())) { this.drop(ws, 1001); return null; }
      return binding;
    } catch { this.drop(ws, 1013); return null; }
  }
  private raw(ws: WebSocket, message: PrivateServerMessage | PublicServerMessage): boolean {
    const json = JSON.stringify(message);
    if (new TextEncoder().encode(json).byteLength > MAX_SERVER_MESSAGE_BYTES) { this.drop(ws, 1011); return false; }
    try { ws.send(json); return true; } catch { this.drop(ws, 1013); return false; }
  }
  private async privateMessage(ws: WebSocket, message: () => PrivateServerMessage): Promise<boolean> {
    if (terminalRoom(this.ctx.storage)) return false;
    if (!await this.authorized(ws)) return false;
    if (expireBidding(this.ctx.storage, Date.now())) this.deadlineChanged = true;
    if (terminalRoom(this.ctx.storage)) return false;
    return this.raw(ws, message());
  }

  private async reconcile(): Promise<{ sockets: WebSocket[]; changed: boolean }> {
    const saved = storedRoom(this.ctx.storage);
    if (!saved) return { sockets: [], changed: false };
    const sockets: WebSocket[] = [];
    const connections = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const binding = await this.authorized(ws);
      if (binding) { sockets.push(ws); connections.add(binding.connectionId); }
    }
    const changed = new PresenceStore(this.ctx.storage, this.emptyTimeoutMs).reconcile(connections, Date.now());
    return { sockets, changed };
  }
  private async scheduleExpiry(): Promise<void> {
    const terminal = terminalRoom(this.ctx.storage);
    if (terminal) {
      const due = terminalDue(terminal);
      if (due === null) await this.ctx.storage.deleteAlarm();
      else if (await this.ctx.storage.getAlarm() !== due) await this.ctx.storage.setAlarm(Math.max(Date.now(), due));
      return;
    }
    const leaseDue = new PresenceStore(this.ctx.storage).nextDeadline();
    const deadlines: number[] = leaseDue === undefined ? [] : [leaseDue];
    const emptyDue = new PresenceStore(this.ctx.storage).nextEmptyDeadline();
    if (emptyDue !== undefined) deadlines.push(emptyDue);
    const room = storedRoom(this.ctx.storage);
    const match = room?.match;
    const duePreparation = preparationDue(match?.version === 2 ? match.job : undefined);
    if (duePreparation !== undefined) deadlines.push(duePreparation);
    if (match?.state.phase === 'bidding') deadlines.push(match.state.deadlineAtMs);
    const state = room?.state;
    if (state?.status === 'playing' && state.match.phase === 'demonstrating' && state.match.disconnect?.status === 'grace') {
      deadlines.push(state.match.disconnect.skipAllowedAtMs);
    }
    if (!deadlines.length) { await this.ctx.storage.deleteAlarm(); return; }
    const due = Math.min(...deadlines);
    if (await this.ctx.storage.getAlarm() !== due) await this.ctx.storage.setAlarm(due);
  }

  /** Validate each recipient immediately before delivery. Failed sends never undo state. */
  async publish(force = true): Promise<void> {
    if (terminalRoom(this.ctx.storage)) { await this.finishClosure(); return; }
    if (this.deadlineChanged) { force = true; this.deadlineChanged = false; }
    let repeat: boolean;
    do {
      repeat = false;
      const { sockets, changed } = await this.reconcile();
      if (terminalRoom(this.ctx.storage)) { await this.finishClosure(); return; }
      if (ensurePreparationJob(this.ctx.storage, Date.now())) force = true;
      if (expireBidding(this.ctx.storage, Date.now())) force = true;
      if (terminalRoom(this.ctx.storage)) { await this.finishClosure(); return; }
      if (force || changed) {
        for (const ws of sockets) {
          if (!await this.authorized(ws)) { repeat = true; continue; }
          if (expireBidding(this.ctx.storage, Date.now())) repeat = true;
          if (terminalRoom(this.ctx.storage)) { await this.finishClosure(); return; }
          const saved = storedRoom(this.ctx.storage);
          if (!saved) continue;
          const message: PublicServerMessage = { version: PROTOCOL_VERSION, type: 'room.snapshot',
            state: saved.state, serverTimeMs: Date.now() };
          const parsed = parsePublicServerMessage(message);
          if (!parsed.ok) throw new Error('Invalid broadcast');
          if (!this.raw(ws, parsed.value)) repeat = true;
        }
      }
      force = repeat;
    } while (repeat);
    await this.scheduleExpiry();
  }

  async connect(sessionId: string, roomId: string): Promise<Response> {
    await this.publish(false);
    if (terminalRoom(this.ctx.storage)) return new Response(null, { status: 410 });
    using session = await this.env.REGISTRY.get(this.env.REGISTRY.idFromName('registry-v1')).verifySessionIdentity(sessionId);
    const saved = storedRoom(this.ctx.storage);
    if (!session) return new Response(null, { status: 401 });
    if (!saved || saved.state.roomId !== roomId) return new Response(null, { status: 404 });
    const seatId = saved.members[sessionId];
    if (!seatId || !saved.state.players.some((p) => p.seatId === seatId)) return new Response(null, { status: 403 });
    const count = this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN && this.binding(ws)?.sessionId === sessionId).length;
    if (count >= 4) return new Response(null, { status: 429 });
    const connectionId = crypto.randomUUID();
    if (!new PresenceStore(this.ctx.storage, this.emptyTimeoutMs).add(connectionId, sessionId, seatId, session.issuedAt, session.expiresAt, Date.now())) {
      await this.publish(false); return new Response(null, { status: 410 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ version: 2, connectionId, sessionId, seatId, roomId,
      issuedAt: session.issuedAt, expiresAt: session.expiresAt } satisfies SocketBinding);
    await this.reconcile();
    const sent = await this.privateMessage(server, () => ({ version: PROTOCOL_VERSION, type: 'session.bound',
      roomId, seatId, connectionId, state: storedRoom(this.ctx.storage)!.state, serverTimeMs: Date.now() }));
    if (!sent) { await this.publish(); return new Response(null, { status: 401 }); }
    await this.publish();
    if (server.readyState !== WebSocket.OPEN) return new Response(null, { status: 401 });
    return new Response(null, { status: 101, webSocket: client });
  }

  async message(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    try {
      await this.publish(false);
      const binding = await this.authorized(ws);
      if (!binding) { await this.publish(false); return; }
      if (!consumeSocketBudget(this.ctx.storage, binding.sessionId, Date.now())) {
        this.drop(ws, 1013); await this.publish(); return;
      }
      const protocolError = async (reason: 'message-too-large' | 'invalid-message' | 'invalid-json' | 'unsupported-version', commandId: string | null = null) => {
        await this.privateMessage(ws, () => ({ version: PROTOCOL_VERSION, type: 'protocol.error',
          commandId, reason, serverTimeMs: Date.now() }));
      };
      if (typeof data !== 'string') { await protocolError('invalid-message'); this.drop(ws, 1003); await this.publish(); return; }
      // Bound before JSON parsing, without allocating an encoder buffer for huge strings.
      if (data.length > MAX_CLIENT_MESSAGE_BYTES || new TextEncoder().encode(data).byteLength > MAX_CLIENT_MESSAGE_BYTES) {
        await protocolError('message-too-large'); this.drop(ws, 1009); await this.publish(); return;
      }
      const parsed = parseSocketMessageJson(data);
      if (!parsed.ok) { await protocolError(parsed.error); if (parsed.error === 'unsupported-version') this.drop(ws, 1002); await this.publish(false); return; }
      const input = parsed.value;
      if ('type' in input) {
        if (input.roomId !== binding.roomId || input.connectionId !== binding.connectionId) { await protocolError('invalid-message'); return; }
        // Authentication may yield: check again immediately before renewing.
        if (!await this.authorized(ws)) { await this.publish(); return; }
        if (new PresenceStore(this.ctx.storage).renew(binding.connectionId, Date.now(), input.sequence)) {
          await this.privateMessage(ws, () => ({ version: PROTOCOL_VERSION, type: 'connection.pong',
            connectionId: binding.connectionId, sequence: input.sequence, serverTimeMs: Date.now() }));
        }
        await this.publish(false);
        return;
      }
      if (!('roomId' in input) || input.roomId !== binding.roomId) { await protocolError('invalid-message', input.commandId); return; }
      if (input.command.type !== 'room.end' && input.command.type !== 'state.request' && input.command.type !== 'board.shuffle' && input.command.type !== 'room.start' && input.command.type !== 'preparation.retry' && input.command.type !== 'bid.submit' &&
        input.command.type !== 'attempt.move' && input.command.type !== 'attempt.undo' && input.command.type !== 'attempt.reset' && input.command.type !== 'attempt.giveUp' && input.command.type !== 'attempt.skipDisconnected' &&
        input.command.type !== 'round.skip' && input.command.type !== 'round.continue' && input.command.type !== 'match.returnToLobby' && input.command.type !== 'command.retry') {
        this.drop(ws, 1013); await this.publish(); return;
      }
      // Recheck immediately before mutation, after any asynchronous boundary.
      if (!await this.authorized(ws)) { await this.publish(); return; }
      if (!new PresenceStore(this.ctx.storage).renew(binding.connectionId, Date.now())) { this.drop(ws, 1001); await this.publish(); return; }
      const result = executeLobbyCommand(this.ctx.storage, binding.sessionId, binding.seatId, input as RoomRequest);
      if (!result) { this.drop(ws, 1013); await this.publish(); return; }
      const ended = terminalRoom(this.ctx.storage);
      if (ended) {
        this.raw(ws, { version: PROTOCOL_VERSION, type: 'command.result', roomId: binding.roomId, commandId: input.commandId,
          outcome: result.outcome, processedRevision: result.processedRevision, currentRevision: ended.lastRevision,
          duplicate: result.duplicate, serverTimeMs: Date.now() });
        await this.finishClosure(); return;
      }
      await this.scheduleExpiry(); // Durable intent is already committed; arm before acknowledging.
      await this.privateMessage(ws, () => ({ version: PROTOCOL_VERSION, type: 'command.result',
        roomId: binding.roomId, commandId: input.commandId, outcome: result.outcome,
        processedRevision: result.processedRevision, currentRevision: storedRoom(this.ctx.storage)!.state.revision,
        duplicate: result.duplicate, serverTimeMs: Date.now() }));
      if (result.changed) await this.publish();
      else {
        if (await this.authorized(ws)) {
          const saved = storedRoom(this.ctx.storage)!;
          const message: PublicServerMessage = { version: PROTOCOL_VERSION, type: 'room.snapshot', state: saved.state, serverTimeMs: Date.now() };
          const checked = parsePublicServerMessage(message);
          if (!checked.ok) throw new Error('Invalid snapshot');
          this.raw(ws, checked.value);
        }
        await this.publish(false);
      }
    } catch {
      this.drop(ws, 1013);
      // Storage outages may prevent reconciliation; cold restore will repair flags.
      try { await this.publish(); } catch { /* no sensitive diagnostics */ }
    }
  }

  private async finishClosure(): Promise<void> {
    const ended = terminalRoom(this.ctx.storage);
    if (!ended) return;
    for (const ws of this.ctx.getWebSockets()) {
      if (await this.authorized(ws)) this.raw(ws, { version: PROTOCOL_VERSION, type: 'room.closed',
        roomId: ended.roomId, reason: ended.reason, lastRevision: ended.lastRevision, serverTimeMs: Date.now() });
      this.drop(ws, 1000);
    }
    await flushRoomTerminal(this.ctx.storage, this.env, Date.now());
    await this.scheduleExpiry();
  }

  async closed(ws: WebSocket, code: number): Promise<void> {
    if (!this.binding(ws)) return;
    this.drop(ws, code === 1000 ? 1000 : 1001);
    await this.publish();
  }

  async alarm(): Promise<void> {
    if (terminalRoom(this.ctx.storage)) { await this.finishClosure(); return; }
    await this.publish(false); // Normalize due liveness before other scheduled work.
    await runPreparationAlarm(this.ctx.storage, Date.now(), undefined, () => Date.now());
    await this.publish(); // Also expires sessions and re-arms all remaining work.
  }
}
