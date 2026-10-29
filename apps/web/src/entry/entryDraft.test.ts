import { afterEach, expect, test, vi } from 'vitest';
import { inviteFromPath, NICKNAME_STORAGE_KEY, normalizeNickname, normalizeRoomCode, readNickname, rememberNickname } from './entryDraft';

afterEach(() => vi.unstubAllGlobals());

test('nickname follows shared trim, Unicode normalization and 24 code-point rules', () => {
  expect(normalizeNickname('  Jose\u0301  ')).toBe('José');
  expect(normalizeNickname('😀'.repeat(24))).toBe('😀'.repeat(24));
  for (const value of ['', '  ', 'a'.repeat(25), 'A\nB']) expect(normalizeNickname(value)).toBeUndefined();
});

test('codes normalize case and reject excluded characters or wrong length', () => {
  expect(normalizeRoomCode(' abc234 ')).toBe('ABC234');
  for (const value of ['', 'ABCD12', 'ABC23', 'ABC2345', 'ＡBC234']) expect(normalizeRoomCode(value)).toBeUndefined();
});

test('invite path only prefills a validated code', () => {
  expect(inviteFromPath('/room/abc234')).toEqual({ code: 'ABC234', invalid: false });
  expect(inviteFromPath('/room/ABC234/')).toEqual({ code: 'ABC234', invalid: false });
  expect(inviteFromPath('/')).toEqual({ code: '', invalid: false });
  for (const path of ['/room/ABCD12', '/room/', '/room/ABC234/extra', '/room/%', '/room/%2FABC234']) {
    expect(inviteFromPath(path)).toEqual({ code: '', invalid: true });
  }
});

test('nickname memory contains only normalized convenience text, never identity', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key),
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  rememberNickname(' Maria ');
  expect(readNickname()).toBe('Maria');
  expect([...values]).toEqual([[NICKNAME_STORAGE_KEY, 'Maria']]);
  rememberNickname('');
  expect(readNickname()).toBe('');
});

test('blocked storage and invalid saved nicknames are harmless', () => {
  vi.stubGlobal('localStorage', { getItem: () => 'x'.repeat(25) });
  expect(readNickname()).toBe('');
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
  expect(readNickname()).toBe('');
  expect(() => rememberNickname('Maria')).not.toThrow();
});
