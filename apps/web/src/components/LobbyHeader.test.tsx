import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { LobbyHeader } from './LobbyHeader';

test('lobby has title/board and copy control above waiting status/connected count', () => {
  const markup = renderToStaticMarkup(<LobbyHeader boardName="Constellation" roomCode="ZR7B9X" connectionLabel="1 online" />);
  expect(markup).toContain('<h1>Match setup</h1>');
  expect(markup).toContain('title="Constellation" aria-live="polite">Constellation');
  expect(markup).toContain('aria-label="Copy room code ZR7B9X"');
  expect(markup).toContain('Lobby · Waiting for players');
  expect(markup).toContain('role="status">1 online');
  expect(markup.indexOf('lobby-header__top')).toBeLessThan(markup.indexOf('lobby-header__bottom'));
  for (const absent of ['ROOM CODE', 'More actions', 'End Room', 'Leave Room']) expect(markup).not.toContain(absent);
});

test('connection feedback/recovery stays available instead of a misleading online count', () => {
  const markup = renderToStaticMarkup(<LobbyHeader boardName="Constellation" roomCode="ZR7B9X"
    connectionLabel="Disconnected." recovery={<button>Reconnect</button>} />);
  expect(markup).toContain('role="status">Disconnected.');
  expect(markup).toContain('>Reconnect</button>');
  expect(markup).not.toContain('online');
});

test('lobby styling is scoped to the header, leaving board margins unchanged', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const block = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split('}')[0];
  expect(block('.lobby-header')).toContain('padding-inline: 5px'); // Added to the existing 5px page padding.
  expect(block('.lobby-header')).toContain('gap: 8px');
  expect(block('.lobby-header h1')).toContain('font-size: 20px');
  expect(block('.lobby-header .lobby-header__board')).toContain('text-overflow: ellipsis');
  expect(block('.lobby-header .room-code__value')).toContain('font-size: 16px');
  expect(block('.lobby-header .room-code__button')).toContain('height: 44px');
});
