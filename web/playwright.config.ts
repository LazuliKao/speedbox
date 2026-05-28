import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    browserName: 'chromium',
    channel: 'msedge',
    headless: false,
    viewport: { width: 1280, height: 720 },
  },
  webServer: undefined,
});