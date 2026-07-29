import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.SPT_E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer:
    process.env.SPT_E2E_EXTERNAL_SERVER === "true"
      ? undefined
      : {
          command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1",
          url: "http://127.0.0.1:3000/api/health",
          reuseExistingServer: true,
          timeout: 120000
        },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } }
  ]
});
