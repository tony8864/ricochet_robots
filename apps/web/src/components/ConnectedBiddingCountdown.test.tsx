import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ConnectedBiddingCountdown } from './ConnectedBiddingCountdown';

test.each([
  [60, '1:00'], [21, '0:21'], [20, '0:20'],
  [16, '0:16'], [11, '0:11'], [10, '0:10'],
  [9, '0:09'], [0, '0:00'],
] as const)('%i seconds displays %s without urgency styling', (seconds, display) => {
  const markup = renderToStaticMarkup(<ConnectedBiddingCountdown deadlineAtMs={100000} getServerNow={() => 100000 - seconds * 1000} />);
  expect(markup).not.toContain('data-urgency');
  expect(markup).toContain(`aria-label="${seconds} seconds remaining">${display}</span>`);
  expect(markup).toContain('role="timer" aria-live="off"');
  expect(markup).not.toContain('Time left');
  expect(markup).not.toContain('<p');
});

test('inline timer stays white with stable tabular sizing and no urgency overrides', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('.bidding-countdown--inline {')).split('}')[0];
  for (const rule of ['width: 4ch', 'font-size: 18px', 'font-weight: 600', 'font-variant-numeric: tabular-nums',
    'line-height: 22px', 'background: none', 'border: 0', 'color: #e8f0fa']) expect(block).toContain(rule);
  expect(css).not.toContain('.bidding-countdown--inline[data-urgency');
});
