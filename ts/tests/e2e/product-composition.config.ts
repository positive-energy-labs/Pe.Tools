import base from "@pe/web/vite.config";
import { defineConfig } from "vite-plus";
import { fileURLToPath } from "node:url";

// Deterministic compositions of actual product modules; browser journeys retain their own configs.
export default defineConfig(async (env) => {
  const config = await (typeof base === "function" ? base(env) : base);
  return {
    ...config,
    root: fileURLToPath(new URL("../../apps/web/", import.meta.url)),
    test: {
      ...config.test,
      fileParallelism: false,
      include: [
        fileURLToPath(new URL("./products/**/*.test.{ts,tsx}", import.meta.url)).replaceAll(
          String.fromCharCode(92),
          "/",
        ),
      ],
    },
  };
});
