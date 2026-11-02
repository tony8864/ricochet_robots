import { MAX_CLIENT_MESSAGE_BYTES, parseClientRequest, type RoomEnteredMessage, type RoomRequest } from '@robot-puzzle/shared';

export const ROOM_RECOVERY_KEY = 'robot-puzzle.room-recovery.v1';
export interface RecoveryRecord {
  readonly version: 1;
  readonly roomId: string;
  readonly roomCode: string;
  readonly seatId: string;
  readonly pending: RoomRequest | null;
  /** Explicit tab departure keeps an uncertain request without automatically rejoining. */
  readonly autoResume?: false;
}
export interface RoomRecoveryStore {
  read(): RecoveryRecord | null;
  save(record: RecoveryRecord): boolean;
  clear(roomId: string): void;
}
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

/** Storage is untrusted routing/retry convenience, never proof of membership. */
export function parseRecoveryRecord(raw: string | null): RecoveryRecord | null {
  if (!raw || raw.length > 8192) return null;
  try {
    const value = JSON.parse(raw);
    const keys = value && Object.keys(value).sort().join(',');
    if (!value || (keys !== 'pending,roomCode,roomId,seatId,version'
      && (keys !== 'autoResume,pending,roomCode,roomId,seatId,version' || value.autoResume !== false))
      || value.version !== 1 || !uuid(value.roomId) || !uuid(value.seatId)
      || typeof value.roomCode !== 'string' || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(value.roomCode)) return null;
    let pending: RoomRequest | null = null;
    if (value.pending !== null) {
      if (new TextEncoder().encode(JSON.stringify(value.pending)).length > MAX_CLIENT_MESSAGE_BYTES) return null;
      // Historical records may only look up a retained receipt, never run v1 gameplay.
      const input = value.pending?.version === 1 ? { version: 2, commandId: value.pending.commandId,
        roomId: value.roomId, context: {}, command: { type: 'command.retry', originalRequest: value.pending } } : value.pending;
      const parsed = parseClientRequest(input);
      if (!parsed.ok || !('roomId' in parsed.value) || parsed.value.roomId !== value.roomId) return null;
      pending = parsed.value;
    }
    return { version: 1, roomId: value.roomId, roomCode: value.roomCode, seatId: value.seatId, pending,
      ...(value.autoResume === false ? { autoResume: false as const } : {}) };
  } catch { return null; }
}

export function roomRecoveryStore(access: StorageAccess = () => sessionStorage): RoomRecoveryStore {
  let memory: RecoveryRecord | null = null;
  return {
    read() { try { return parseRecoveryRecord(access().getItem(ROOM_RECOVERY_KEY)); } catch { return memory; } },
    save(record) {
      memory = record;
      try { access().setItem(ROOM_RECOVERY_KEY, JSON.stringify(record)); return true; } catch { return false; }
    },
    clear(roomId) {
      if (memory?.roomId === roomId) memory = null;
      try {
        if (parseRecoveryRecord(access().getItem(ROOM_RECOVERY_KEY))?.roomId === roomId) access().removeItem(ROOM_RECOVERY_KEY);
      } catch { /* Storage is unavailable; this instance still stops recovery. */ }
    },
  };
}

export function recoveryRecord(entry: RoomEnteredMessage, pending: RoomRequest | null): RecoveryRecord {
  return { version: 1, roomId: entry.roomId, roomCode: entry.state.roomCode, seatId: entry.seatId, pending };
}
