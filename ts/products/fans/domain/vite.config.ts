import { defineConfig } from "vite-plus";
export default defineConfig({
  test: {
    globalSetup: ["../../../tests/isolated-home/global-setup.ts"],
    setupFiles: ["../../../tests/isolated-home/setup.ts"],
    env: { PE_LANE: "dev" },
    testTimeout: 15000,
  },
});
