import { defineConfig } from "@playwright/test";

// Runs against a deployed or local origin. WebMCP needs a real origin (https or localhost; both verified).
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8787",
    channel: "chrome",
    headless: true,
    launchOptions: { args: ["--enable-blink-features=WebMCP,WebMCPTesting"] },
    video: process.env.E2E_VIDEO ? "on" : "off",
    viewport: { width: 1440, height: 900 },
  },
});
