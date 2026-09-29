import { defineConfig, devices } from '@playwright/test';

/**
 * Full-stack end-to-end suite: the real UI against a local chain, local
 * Supabase and locally served edge functions. Start the stack first with
 * `npm run e2e:stack`; this config serves the site, the functions and the
 * mail catcher around it.
 */
export default defineConfig({
  testDir: './e2e/full',
  testMatch: /.*\.e2e\.ts$/,
  // Fresh chain and database before every run (skip with E2E_REUSE_STACK=1).
  globalSetup: './e2e/stack/global-setup.ts',
  // Journeys share one chain and database, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/stack/mail-capture.mjs',
      url: 'http://127.0.0.1:4010/emails',
      reuseExistingServer: true,
    },
    {
      command:
        'npx supabase functions serve --workdir e2e/.stack/supabase-workdir --env-file e2e/.stack/functions.env',
      wait: { stdout: /Serving functions|Functions URL|serving/i },
      // Never reused: the functions read this run's addresses at start-up.
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command:
        'npx vite build --mode e2e && npx vite preview --mode e2e --host 127.0.0.1 --port 4174',
      url: 'http://127.0.0.1:4174',
      // Always rebuilt: the build embeds this run's contract addresses.
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 14'] } },
  ],
});
