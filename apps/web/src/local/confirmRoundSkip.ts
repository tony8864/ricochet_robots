import type { LocalMatchController } from './controller';

/** Confirm only the current host's current unbid round; T11 enforces the rules too. */
export function confirmRoundSkip(
  controller: LocalMatchController,
  confirm: (message: string) => boolean = (message) => window.confirm(message),
) {
  const before = controller.getSnapshot();
  if (before.match.phase !== 'thinking' || before.actingSeatId !== before.hostSeatId) return null;
  if (!confirm('Skip this round? No points will be awarded. Robots stay in place, this target remains used, and the round counts toward the match total.')) return null;

  // Never apply an old confirmation to another seat, phase, or round.
  const current = controller.getSnapshot();
  if (current.match !== before.match || current.actingSeatId !== before.actingSeatId || current.hostSeatId !== before.hostSeatId) return null;
  return controller.sendPlayer({ type: 'round.skip', confirmed: true });
}
