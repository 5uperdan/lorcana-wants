import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure modules run in Node. DOM tests opt in per file with a
    // `@vitest-environment jsdom` docblock, so they pay for jsdom and the
    // other tests don't.
    environment: "node",
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["js/**/*.js"],
      // main.js is the bootstrap that supplies real browser globals. There is
      // nothing in it to test that app.js does not already cover.
      exclude: ["js/main.js"],
      // Lines and statements are held high. Functions and branches sit a
      // little lower because the file-reading callbacks and the copy-button
      // timeout are browser plumbing with nothing worth asserting.
      thresholds: { lines: 90, statements: 90, functions: 85, branches: 85 },
    },
  },
});
