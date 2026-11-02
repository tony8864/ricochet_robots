import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { DisconnectedAttemptPanel } from './DisconnectedAttemptPanel';

const disconnect = { disconnectId: '00000000-0000-4000-8000-000000000001', disconnectedAtMs: 1000, skipAllowedAtMs: 61000, status: 'grace' as const };
test.each([true, false])('disconnect state keeps attempt information, yellow clock and host-only action (host=%s)', (isHost) => {
  const skip = vi.fn();
  const markup = renderToStaticMarkup(<DisconnectedAttemptPanel nickname="Tony" bid={7} moveCount={2} disconnect={disconnect}
    isHost={isHost} disabled={false} pending={false} getServerNow={() => 45000} onSkip={skip} />);
  expect(markup).toContain('Tony · Bid: 7'); expect(markup).toContain('Moves: 2 / 7');
  expect(markup).toContain('Tony is disconnected.'); expect(markup).toContain('16 seconds to reconnect">0:16');
  expect(markup).toContain('class="disconnected-attempt__wifi-off" width="16" height="16"');
  expect(markup).toContain('aria-hidden="true" focusable="false"');
  expect(markup.indexOf('disconnected-attempt__wifi-off')).toBeLessThan(markup.indexOf('Tony is disconnected.'));
  expect(markup.includes('Skip Attempt')).toBe(isHost);
  if (isHost) expect(markup).toContain('disabled=""');
  expect(skip).not.toHaveBeenCalled();
});

test.each(['grace', 'skippable'] as const)('local zero never invents server skip eligibility (%s)', (status) => {
  const render = (disabled: boolean) => renderToStaticMarkup(<DisconnectedAttemptPanel nickname="Tony" bid={7} moveCount={2}
    disconnect={{ ...disconnect, status }} isHost disabled={disabled} pending={false} getServerNow={() => 61000} onSkip={vi.fn()} />);
  expect(render(false).includes('disabled=""')).toBe(status === 'grace');
  expect(render(true)).toContain('disabled=""'); expect(render(false)).toContain('>0:00</span>');
});

test('panel and button use the agreed compact styling without modifying header or board', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const block = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split('}')[0];
  for (const rule of ['padding: 12px', 'border: 1px solid #263852', 'border-radius: 10px', 'background: #111f35']) expect(block('.disconnected-attempt')).toContain(rule);
  for (const rule of ['height: 44px', 'border-radius: 10px', 'background: #B94352', 'color: #fff', 'box-shadow: none']) expect(block('.disconnected-attempt__skip')).toContain(rule);
  expect(block('.disconnected-attempt__skip:disabled')).toContain('background: #3A4658; color: #8995A6');
  expect(block('.disconnected-attempt__countdown')).toContain('color: #FFD166');
  expect(block('.disconnected-attempt__wifi-off')).toContain('color: #FFD166');
});
