import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { LeaveRoomDialog } from './LeaveRoomDialog';

test.each([false, true])('leave confirmation describes tab-local retention, not membership removal (pending=%s)', (unresolved) => {
  const onConfirm = vi.fn(); const onCancel = vi.fn();
  const markup = renderToStaticMarkup(<LeaveRoomDialog unresolved={unresolved} error="" onCancel={onCancel} onConfirm={onConfirm} />);
  expect(markup).toContain('aria-modal="true"'); expect(markup).toContain('Leave this room?');
  expect(markup).toContain('Your seat, bids and points will be kept.'); expect(markup).toContain('Other tabs stay connected.');
  expect(markup.includes('Leaving does not cancel it')).toBe(unresolved);
  expect(markup).toContain('>Cancel</button>'); expect(markup).toContain('>Leave Room</button>');
  expect(onConfirm).not.toHaveBeenCalled(); expect(onCancel).not.toHaveBeenCalled();
});

test('departure persistence failure stays inside the confirmation rather than silently navigating', () => {
  const markup = renderToStaticMarkup(<LeaveRoomDialog unresolved error="You are still in the room."
    onCancel={vi.fn()} onConfirm={vi.fn()} />);
  expect(markup).toContain('role="alert">You are still in the room.');
});

test('only the Leave Room confirmation uses the requested red background', () => {
  const markup = renderToStaticMarkup(<LeaveRoomDialog unresolved={false} error="" onCancel={vi.fn()} onConfirm={vi.fn()} />);
  expect(markup).toContain('class="leave-room-dialog__confirm">Leave Room</button>');
  expect(markup).not.toMatch(/class="leave-room-dialog__confirm"[^>]*>Cancel/);
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  expect(css).toContain('.leave-room-dialog__actions .leave-room-dialog__confirm { background: #B94352; }');
});
