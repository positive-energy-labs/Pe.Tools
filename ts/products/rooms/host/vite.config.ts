import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    globalSetup: "../../../tests/isolated-home/global-setup.ts",
    setupFiles: ["../../../tests/isolated-home/setup.ts"],
    env: { PE_LANE: "dev" },
    fileParallelism: false,
    testTimeout: 15_000,
    expect: { poll: { timeout: 10_000 } },
  },
});
