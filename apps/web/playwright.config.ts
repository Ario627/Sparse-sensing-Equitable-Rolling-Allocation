import { defineConfig, devices } from "@playwright/test";

declare const process: { env: Record<string, string | undefined> };

const PREVIEW_PORT = 4173;
const BASE_URL = `http://localhost:${PREVIEW_PORT}`;
const PREVIEW_TIMEOUT_MS = 120_000;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.artifacts",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI !== undefined ? 2 : 0,
  workers: process.env.CI !== undefined ? 2 : undefined,
  reporter:
    process.env.CI !== undefined ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  },
  webServer: {
    command: "npm run build && npm run preview",
    url: BASE_URL,
    reuseExistingServer: process.env.CI === undefined,
    timeout: PREVIEW_TIMEOUT_MS,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
