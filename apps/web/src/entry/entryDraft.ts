import { parseClientRequest, PROTOCOL_VERSION } from '@robot-puzzle/shared';

// Validation only: never sent or used as a network command identity.
const validationId = '00000000-0000-4000-8000-000000000001';
export const NICKNAME_STORAGE_KEY = 'robot-puzzle.nickname';

export function normalizeNickname(value: string): string | undefined {
  const result = parseClientRequest({ version: PROTOCOL_VERSION, commandId: validationId,
    command: { type: 'room.create', nickname: value } });
  return result.ok && result.value.command.type === 'room.create' ? result.value.command.nickname : undefined;
}

export function normalizeRoomCode(value: string): string | undefined {
  const result = parseClientRequest({ version: PROTOCOL_VERSION, commandId: validationId,
    command: { type: 'room.join', nickname: 'Player', roomCode: value } });
  return result.ok && result.value.command.type === 'room.join' ? result.value.command.roomCode : undefined;
}

export function inviteFromPath(pathname: string): { code: string; invalid: boolean } {
  if (!pathname.startsWith('/room/')) return { code: '', invalid: false };
  try {
    const match = /^\/room\/([^/]+)\/?$/.exec(pathname);
    const code = match ? normalizeRoomCode(decodeURIComponent(match[1]!)) : undefined;
    return { code: code ?? '', invalid: !code };
  } catch {
    return { code: '', invalid: true };
  }
}

export function readNickname(): string {
  try { return normalizeNickname(localStorage.getItem(NICKNAME_STORAGE_KEY) ?? '') ?? ''; }
  catch { return ''; }
}

export function rememberNickname(value: string): void {
  try {
    const nickname = normalizeNickname(value);
    if (nickname) localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
    else localStorage.removeItem(NICKNAME_STORAGE_KEY);
  } catch { /* Storage may be blocked; the form remains usable. */ }
}
