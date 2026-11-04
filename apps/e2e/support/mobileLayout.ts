import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export const layoutSizes = [
  { width: 320, height: 568 }, { width: 375, height: 667 },
  { width: 390, height: 844 }, { width: 768, height: 1024 },
  { width: 1032, height: 1376 }, { width: 1280, height: 800 },
  { width: 390, height: 320 }, // Short viewport, not a claim of native keyboard emulation.
];

export async function expectMobileLayout(page: Page, board = true) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (board) {
    const bounds = await page.locator('.board-preview__canvas').boundingBox();
    expect(bounds).not.toBeNull();
    expect(Math.abs(bounds!.width - bounds!.height)).toBeLessThanOrEqual(1);
    expect(bounds!.x).toBeGreaterThanOrEqual(5);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 5 + 1);
  }
  const targets = await page.locator('button:visible, input:visible').evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName,
      width: bounds.width, height: bounds.height };
  }));
  // SVG robot cells aren't HTML touch controls; dedicated selectors remain 44px.
  for (const target of targets) {
    expect(target.width, `${target.name} width`).toBeGreaterThanOrEqual(44 - 0.1);
    expect(target.height, `${target.name} height`).toBeGreaterThanOrEqual(44 - 0.1);
  }
}
