import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/e2e/product-selection.test.ts"],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 20_000,
  },
});
