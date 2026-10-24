import { defineConfig } from "vite-plus";

// Borrows only explicitly named Chrome and source runtime resources; owns neither lifecycle.
export default defineConfig({
  test: {
    include: ["tests/e2e/conversation-work.test.ts"],
    fileParallelism: false,
    testTimeout: 240_000,
    hookTimeout: 20_000,
  },
});
