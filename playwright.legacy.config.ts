import { defineConfig } from '@playwright/test';
import config from './playwright.config';

const port = 8792;
const baseURL = 'http://127.0.0.1:' + port;

export default defineConfig({
  ...config,
  testIgnore: [],
  testMatch: 'legacy.spec.ts',
  use: { ...config.use, baseURL },
  webServer: {
    ...config.webServer,
    command: 'node scripts/test-worker.mjs ' + port + ' --legacy',
    url: baseURL + '/api/v1/ready'
  }
});
