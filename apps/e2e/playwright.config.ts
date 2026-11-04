import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  forbidOnly: !!process.env.CI,
  use: {
    browserName: 'chromium',
    headless: true,
    // Only the disposable runner context trusts Miniflare's local test TLS.
    ignoreHTTPSErrors: true,
    // Chromium's WSS path also needs the exception at launch. This browser is
    // created/disposed by Playwright; never apply it to a user's browser profile.
    launchOptions: { args: ['--ignore-certificate-errors'] },
    viewport: { width: 390, height: 844 },
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
});
