import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

// Run from this workspace with `pnpm --filter @robot-puzzle/e2e icons:generate`.
// Uses the existing managed browser; no system browser, network or new dependency.
const directory = resolve('..', 'web', 'public', 'icons');
const source = await readFile(resolve(directory, 'robot-puzzle.svg'), 'utf8');
const browser = await chromium.launch();
try {
  for (const [name, size, maskable] of [
    ['icon-192.png', 192, false],
    ['icon-512.png', 512, false],
    ['icon-maskable-512.png', 512, true],
    ['apple-touch-icon.png', 180, false],
  ] as const) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    try {
      await page.setContent(`<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${source}`);
      // Extra breathing room for launcher masks; the opaque background bleeds.
      if (maskable) await page.locator('svg').evaluate((svg) => svg.setAttribute('viewBox', '-32 -32 576 576'));
      await page.screenshot({ path: resolve(directory, name), animations: 'disabled' });
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
