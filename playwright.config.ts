import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/layout',
  use: { browserName: 'chromium', channel: 'msedge', headless: true },
  reporter: 'list',
  workers: 2,
});
