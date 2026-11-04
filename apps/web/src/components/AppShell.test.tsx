import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { AppShell } from './AppShell';

test('shows the package version in a noninteractive app footer after the screen content', () => {
  const markup = renderToStaticMarkup(<AppShell><main>Game screen</main></AppShell>);
  expect(markup).toContain('<main>Game screen</main><footer class="app-version" aria-label="App version v0.1.0">v0.1.0</footer>');
});
