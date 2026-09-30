import { defineConfig, devices } from '@playwright/test';

/** Live post-deploy canary. See e2e/canary/. */
export default defineConfig({
  testDir: './e2e/canary',
  testMatch: /.*\.canary\.ts$/,
  timeout: 60_000,
  retries: 1,
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone', use: { ...devices['iPhone 14'] } },
  ],
});
