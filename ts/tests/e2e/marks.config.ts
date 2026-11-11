import { defineConfig } from "vite-plus";

// Launches its own headless Chrome on a fixture page; no host, no Revit.
export default defineConfig({
  test: {
    globalSetup: ["tests/isolated-home/global-setup.ts"],
    setupFiles: ["tests/isolated-home/setup.ts"],
    include: ["tests/e2e/marks.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
});
