import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { LobbyActions } from './LobbyActions';

test('host sees enabled Shuffle then Start with decorative 16px icons', () => {
  const markup = renderToStaticMarkup(<LobbyActions isHost hostNickname="Maria" onShuffle={() => {}} onStart={() => {}} />);
  expect(markup.indexOf('Shuffle Board')).toBeLessThan(markup.indexOf('Start Match'));
  const buttons = [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].map(([button]) => button);
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).not.toContain('disabled');
  expect(buttons[1]).not.toContain('disabled');
  expect(markup.match(/aria-hidden="true" focusable="false" width="16" height="16"/g)).toHaveLength(2);
});

test('non-host sees the waiting message instead of either action', () => {
  const markup = renderToStaticMarkup(<LobbyActions isHost={false} hostNickname="Maria" onShuffle={() => {}} onStart={() => {}} />);
  expect(markup).toContain('Waiting for Maria to start the match.');
  expect(markup).not.toContain('<button');
});

test('network lobby may disable actions and label an exact shuffle retry without affecting local defaults', () => {
  const markup = renderToStaticMarkup(<LobbyActions isHost hostNickname="Maria" onShuffle={() => {}} onStart={() => {}}
    shuffleDisabled startDisabled shuffleLabel="Retry Shuffle" />);
  const buttons = [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].map(([button]) => button);
  expect(buttons.every((button) => button.includes('disabled'))).toBe(true);
  expect(markup).toContain('Retry Shuffle');
});
