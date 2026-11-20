import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/journey-fixtures/fans-reds.test.ts"],
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 20_000,
  },
});
