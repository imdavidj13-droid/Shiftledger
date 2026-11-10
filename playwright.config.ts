import { defineConfig } from '@playwright/test';

const port = 8791;
const baseURL = 'http://127.0.0.1:' + port;

export default defineConfig({
  testDir: './tests',
  testIgnore: 'legacy.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined
  },
  webServer: {
    command: 'node scripts/test-worker.mjs ' + port,
    url: baseURL + '/api/v1/ready',
    timeout: 120_000,
    reuseExistingServer: false
  }
});
