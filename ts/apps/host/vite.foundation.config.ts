import { defineConfig } from "vite-plus";

// Host-only boundary lane: no route generation, app startup, browser or native session.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ["tests/command-foundation.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 10000,
  },
});
