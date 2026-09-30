import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:3010",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev --port 3010",
    url: "http://127.0.0.1:3010/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL:
        "postgresql://postgres:postgres@localhost:55432/time_os_test",
      BETTER_AUTH_SECRET:
        "better-auth-test-secret-that-is-at-least-32-characters",
      BETTER_AUTH_URL: "http://127.0.0.1:3010",
    },
  },
});
