import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  define: {
    __PE_WEB_RECEIPT_BUILD__: JSON.stringify({ version: "test", build: "test", commit: "test" }),
  },
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "journeys/*.test.ts"],
    // The reds journey drives an attached browser through its own config.
    exclude: ["journeys/fans-reds.test.ts"],
    setupFiles: [
      "../../../tests/isolated-home/setup.ts",
      fileURLToPath(import.meta.resolve("@pe/web-kernel/test-setup")),
    ],
    globalSetup: ["../../../tests/isolated-home/global-setup.ts"],
    testTimeout: 15_000,
  },
});
