import { defineConfig } from "vite-plus";

// Opt-in: this suite borrows an explicitly named chrome-agent page, never launches a host.
export default defineConfig({
  test: {
    include: ["tests/e2e/route-chaos.test.ts"],
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 20_000,
  },
});
