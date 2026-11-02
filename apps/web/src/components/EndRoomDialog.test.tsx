import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { EndRoomDialog } from './EndRoomDialog';
import { MatchActions } from './MatchActions';

test('host End is the last menu item, below its separator, with the Lucide closed-door icon', () => {
  const markup = renderToStaticMarkup(<MatchActions onSkip={vi.fn()} onEnd={vi.fn()} />);
  expect(markup.indexOf('Skip Round')).toBeLessThan(markup.indexOf('role="separator"'));
  expect(markup.indexOf('role="separator"')).toBeLessThan(markup.indexOf('match-actions__end'));
  expect(markup).toContain('M19 21V5'); expect(markup).toContain('width="16" height="16"');
  expect(markup).toContain('End Room</button>'); expect(markup).not.toContain('Leave Room');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  expect(css).toContain('.match-actions__panel .match-actions__end { color: #F0A5A9; font-size: 14px; font-weight: 500; }');
  expect(css).toContain('background: #263852'); expect(css).toContain('.match-actions__skip-icon { flex: none; color: #A8BED8; }');
});

test.each([false, true])('End confirmation reuses the existing red modal styling and protects pending requests (%s)', (pending) => {
  const confirm = vi.fn(); const cancel = vi.fn();
  const markup = renderToStaticMarkup(<EndRoomDialog pending={pending} disabled={false} onCancel={cancel} onConfirm={confirm}
    feedback={<button>Retry pending request</button>} />);
  expect(markup).toContain('class="leave-room-dialog end-room-dialog"'); expect(markup).toContain('aria-modal="true"');
  expect(markup).toContain('This room cannot be reopened.'); expect(markup).toContain('class="leave-room-dialog__confirm"');
  expect(markup.includes('Ending…')).toBe(pending); expect(markup).toContain('Retry pending request');
  expect(confirm).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
});
