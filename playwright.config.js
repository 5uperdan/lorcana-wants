import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  // Two suites with different contracts. "smoke" stubs the network and gates
  // every push. "contract" really calls Lorcast and runs on a schedule, so a
  // third party having a bad morning never fails somebody's pull request.
  projects: [
    { name: "smoke", testDir: "./tests/e2e", use: { ...devices["Desktop Chrome"] } },
    { name: "contract", testDir: "./tests/contract", use: { ...devices["Desktop Chrome"] } },
  ],
  use: { baseURL: `http://localhost:${PORT}` },
  reporter: process.env.CI ? "github" : "list",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The same server the README tells a developer to use. Serving the
  // repository as static files is exactly what GitHub Pages does.
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
