import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive a real hub (built by `cargo build`) in WebKit, the
// iPhone's engine, on an iPhone-sized screen. Face ID runs in Chromium,
// whose virtual authenticator stands in for the iPhone's passkey; WebKit has
// none.
//
// A hidden browser still plays sound: the tests start the game muted (see
// `hub.ts`), and Chromium is muted outright.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: 'list',
  projects: [
    {
      name: 'iphone',
      testIgnore: /faceid\.spec\.ts/,
      // The test hub's HTTPS front uses a throwaway self-signed certificate.
      use: { ...devices['iPhone 13'], ignoreHTTPSErrors: true },
    },
    {
      name: 'passkeys',
      testMatch: /faceid\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        launchOptions: { args: ['--mute-audio'] },
      },
    },
  ],
});
