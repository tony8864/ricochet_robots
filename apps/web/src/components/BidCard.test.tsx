import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { BidCard } from './BidCard';

const render = (acceptedBid?: number) => renderToStaticMarkup(<BidCard acceptedBid={acceptedBid} onPlaceBid={() => ({ status: 'accepted' })} />);

test('renders the specified label, editable number, moves caption, and Place Bid', () => {
  const markup = render();
  expect(markup).toContain('>YOUR BID</label>');
  expect(markup).toContain('class="bid-card__number"');
  expect(markup).toContain('value="1"');
  expect(markup).toContain('>moves</span>');
  expect(markup).toContain('>Place Bid</button>');
  expect(markup.match(/<button\b/g)).toHaveLength(3);
});

test('numeric field supports phone entry and is connected to its accessible label and units', () => {
  const markup = render();
  const field = markup.match(/<input[^>]+>/)![0];
  expect(field).toContain('type="text"');
  expect(field).toContain('inputMode="numeric"');
  expect(field).toContain('pattern="[0-9]*"');
  expect(field).toContain('enterKeyHint="done"');
  const id = field.match(/\bid="([^"]+)"/)![1];
  expect(markup).toContain(`for="${id}"`);
  expect(field).toContain(`aria-describedby="${id}-units"`);
  expect(markup).toContain(`id="${id}-units"`);
});

test('minus is disabled at one, plus works, and a first valid bid can be submitted', () => {
  const markup = render();
  const buttons = [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].map(([button]) => button);
  expect(buttons[0]).toContain('aria-label="Decrease bid"');
  expect(buttons[0]).toContain('disabled=""');
  expect(buttons[1]).toContain('aria-label="Increase bid"');
  expect(buttons[1]).not.toContain('disabled');
  expect(buttons[2]).not.toContain('disabled');
  expect(buttons[2]).not.toContain('<svg');
  expect(markup).not.toContain('<form');
});

test('returning player starts from their accepted bid and is prompted to lower it', () => {
  const markup = render(7);
  expect(markup).toContain('value="7"');
  expect(markup).toContain('Your accepted bid: 7 moves.');
  expect(markup).toContain('You may lower this bid.');
  const buttons = [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].map(([button]) => button);
  expect(buttons[0]).not.toContain('disabled');
  expect(buttons[1]).toContain('disabled');
  expect(buttons[2]).toContain('disabled');
});

test('accepted minimum bid uses singular units and cannot be lowered or raised', () => {
  const markup = render(1);
  expect(markup).toContain('Your accepted bid: 1 move.');
  expect(markup).toContain('This is the minimum bid.');
  const buttons = [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].map(([button]) => button);
  expect(buttons.every((button) => button.includes('disabled'))).toBe(true);
});
