import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { ActiveMatchHeader } from './ActiveMatchHeader';

const props = { round: 2, phase: 'Thinking', boardName: 'Switchback', targetLabel: 'Green crescent',
  targetColor: 'var(--color-robot-green)', roomCode: 'V9KQH5', connectionLabel: '2 online' };

test('compact header puts phase and code/actions first, then one-line target and presence', () => {
  const skip = vi.fn();
  const markup = renderToStaticMarkup(<ActiveMatchHeader {...props} onSkip={skip} />);
  expect(markup).toContain('ROUND 2 / 10');
  expect(markup).toContain('<h1>Thinking</h1>');
  expect(markup).toContain('Switchback · <span style="color:var(--color-robot-green)">Green crescent</span>');
  expect(markup).toContain('title="Switchback · Green crescent"');
  expect(markup).toContain('aria-label="Copy room code V9KQH5"');
  expect(markup).toContain('aria-label="More actions" aria-expanded="false"');
  expect(markup).toContain('hidden="" role="group" aria-label="Match actions"');
  expect(markup).toContain('>Skip Round</button>');
  expect(markup).toContain('role="status">2 online');
  expect(markup.indexOf('active-match-header__top')).toBeLessThan(markup.indexOf('active-match-header__bottom'));
  expect(markup).not.toContain('ROOM CODE');
  expect(markup).not.toContain('Leave Room');
  expect(skip).not.toHaveBeenCalled();
});

test('no permitted actions invents no leave/skip behavior; pending skip stays disabled', () => {
  const empty = renderToStaticMarkup(<ActiveMatchHeader {...props} targetLabel={null} />);
  expect(empty).not.toContain('More actions');
  expect(empty).not.toContain('match-actions__panel');
  expect(empty).not.toContain('No actions available.');
  expect(empty).not.toContain('Skip Round');
  expect(empty).not.toContain('Switchback ·');
  const pending = renderToStaticMarkup(<ActiveMatchHeader {...props} onSkip={vi.fn()} skipDisabled />);
  expect(pending).toMatch(/<button type="button" disabled=""><svg.*?<\/svg>Skip Round<\/button>/);
  expect(pending).toContain('class="match-actions__skip-icon" width="16" height="16"');
});

test('countdown sits beside the phase without a separate row and recovery stays accessible', () => {
  const markup = renderToStaticMarkup(<ActiveMatchHeader {...props} phase="Bidding" connectionLabel="Disconnected."
    countdown={<strong role="timer">0:42</strong>} recovery={<button>Reconnect</button>} />);
  expect(markup).toContain('class="active-match-header__phase"><h1>Bidding</h1><strong role="timer">0:42</strong></div>');
  expect(markup.indexOf('role="timer"')).toBeLessThan(markup.indexOf('active-match-header__bottom'));
  expect(markup).not.toContain('active-match-header__countdown');
  expect(markup).toContain('role="status">Disconnected.');
  expect(markup).toContain('>Reconnect</button>');
});

test('header sizing is scoped, keeps 44px actions and truncates detail without changing board sizing', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const block = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split('}')[0];
  expect(block('.active-match-header')).toContain('gap: 8px');
  expect(block('.active-match-header__detail')).toContain('min-width: 0');
  expect(block('.active-match-header__detail')).toContain('white-space: nowrap');
  expect(block('.active-match-header__detail')).toContain('text-overflow: ellipsis');
  expect(block('.match-actions__toggle')).toContain('width: 44px; height: 44px');
  expect(block('.active-match-header .room-code__button')).toContain('height: 44px');
  expect(block('.active-match-header__phase')).toContain('gap: 12px');
  expect(block('.active-match-header__phase')).toContain('min-height: 22px');
  expect(css.split('\n').find((line) => line.startsWith('.active-match-header h1 {'))).toContain('white-space: nowrap');
  const panel = block('.match-actions__panel');
  for (const rule of ['position: absolute', 'right: 0', 'width: 190px', 'max-width: calc(100vw - 20px)',
    'background: #111f35', 'border: 1px solid #3a5272', 'border-radius: 10px', 'padding: 4px', 'box-shadow: none', 'z-index: 10']) {
    expect(panel).toContain(rule);
  }
  expect(block('.match-actions__panel button')).toContain('min-height: 44px');
  expect(block('.match-actions__panel button')).toContain('font-size: 14px');
  expect(block('.match-actions__panel button')).toContain('gap: 12px');
  expect(block('.match-actions__skip-icon')).toContain('color: #A8BED8');
});
