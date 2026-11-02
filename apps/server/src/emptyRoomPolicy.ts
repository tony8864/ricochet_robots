export const EMPTY_ROOM_TIMEOUT_MS = 30 * 60 * 1000;

/** Local manual testing only. Production always uses the approved 30 minutes. */
export function emptyRoomTimeout(env: { readonly APP_ENV: string; readonly LOCAL_EMPTY_ROOM_TIMEOUT_SECONDS?: unknown }): number {
  const value = env.LOCAL_EMPTY_ROOM_TIMEOUT_SECONDS;
  if (env.APP_ENV !== 'local' || value === undefined || value === '') return EMPTY_ROOM_TIMEOUT_MS;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1800) {
    throw new Error('LOCAL_EMPTY_ROOM_TIMEOUT_SECONDS must be an integer from 1 to 1800');
  }
  return Number(value) * 1000;
}
