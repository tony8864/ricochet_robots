import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { startEnvironment, type E2eEnvironment } from './environment';

export const test = base.extend<{
  guestContext: BrowserContext;
  guestPage: Page;
}, { environment: E2eEnvironment; controlledTime: boolean }>({
  controlledTime: [false, { scope: 'worker', option: true }],
  environment: [async ({ controlledTime }, use) => {
    const environment = await startEnvironment(controlledTime);
    try { await use(environment); } finally { await environment.close(); }
  }, { scope: 'worker', timeout: 60_000 }],
  baseURL: async ({ environment }, use) => { await use(environment.origin); },
  guestContext: async ({ browser, environment }, use) => {
    const context = await browser.newContext({
      baseURL: environment.origin, ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
    });
    try { await use(context); } finally { await context.close(); }
  },
  guestPage: async ({ guestContext }, use) => {
    const page = await guestContext.newPage();
    await use(page);
  },
});

export { expect };
