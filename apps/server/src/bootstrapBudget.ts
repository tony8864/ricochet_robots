/** Caller owns the Registry-local SQLite transaction. No replay records are deleted. */
export function consumeBootstrapBudget(
  storage: DurableObjectStorage, sessionId: string, creating: boolean, now: number,
): boolean {
  storage.sql.exec(`DELETE FROM bootstrap_budgets WHERE session_id IN (
    SELECT session_id FROM bootstrap_budgets WHERE window_start < ?
    AND NOT EXISTS (SELECT 1 FROM browser_sessions WHERE
      browser_sessions.session_id = bootstrap_budgets.session_id AND expires_at > ?) LIMIT 256
  )`, now - 86_400_000, now);
  const windowStart = Math.floor(now / 60_000) * 60_000;
  const budget = storage.sql.exec<{ window_start: number; total_count: number; create_count: number }>(
    'SELECT window_start, total_count, create_count FROM bootstrap_budgets WHERE session_id = ?', sessionId,
  ).toArray()[0];
  const total = budget?.window_start === windowStart ? budget.total_count : 0;
  const creates = budget?.window_start === windowStart ? budget.create_count : 0;
  if (total >= 30 || (creating && creates >= 5)) return false;
  storage.sql.exec(`INSERT INTO bootstrap_budgets VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET window_start = excluded.window_start,
    total_count = excluded.total_count, create_count = excluded.create_count`,
  sessionId, windowStart, total + 1, creates + Number(creating));
  return true;
}
