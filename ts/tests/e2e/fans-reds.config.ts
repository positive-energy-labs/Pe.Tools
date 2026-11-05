import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/e2e/fans-reds.test.ts"],
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 20_000,
  },
});
