import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3210);

/**
 * End-to-end tests run against a dev server on a throwaway embedded database (.data-e2e) with its own
 * build directory, so they never touch local development data.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `rm -rf .data-e2e && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      APP_URL: `http://localhost:${PORT}`,
      ECCA_DATA_DIR: ".data-e2e",
      NEXT_DIST_DIR: ".next-e2e",
      PLATFORM_ADMIN_EMAILS: "admin@passport.test",
      ...(process.env.ECCA_FAKE_NOW ? { ECCA_FAKE_NOW: process.env.ECCA_FAKE_NOW } : {}),
    },
  },
});
