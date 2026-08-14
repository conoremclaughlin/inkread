import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the web reader.
 *
 * These drive a real browser against the app and the local Supabase stack —
 * the layer unit tests can't reach: layout, selection gestures, page turns,
 * and the round trip from a highlight to the database and back.
 *
 * Run: `yarn workspace @inkread/web e2e` (starts the dev server if one isn't
 * already listening on 6021). The suite skips itself when Supabase is down.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    baseURL: process.env.APP_URL ?? 'http://127.0.0.1:6021',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'yarn dev',
    url: process.env.APP_URL ?? 'http://127.0.0.1:6021',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
