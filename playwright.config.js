const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 10_000,
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  use: {
    baseURL: "http://127.0.0.1:3000",
  },
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
  },
});
