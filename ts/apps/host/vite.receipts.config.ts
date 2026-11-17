import { defineConfig } from "vite-plus";

// Retained storage boundary only: no app startup, route generation or native session.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ["tests/retained-receipt.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 10000,
    env: { PE_LANE: "dev" },
    globalSetup: ["../../tests/isolated-home/global-setup.ts"],
    setupFiles: ["../../tests/isolated-home/setup.ts"],
  },
});
