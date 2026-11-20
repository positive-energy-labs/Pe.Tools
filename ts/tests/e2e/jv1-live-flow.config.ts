import base from "./product-composition.config.ts";
import { defineConfig } from "vite-plus";
import { fileURLToPath } from "node:url";

export default defineConfig(async (env) => {
  const config = await (typeof base === "function" ? base(env) : base);
  return {
    ...config,
    test: {
      ...config.test,
      include: [
        fileURLToPath(new URL("./jv1-live-flow.journey.test.ts", import.meta.url)).replaceAll(
          "\\",
          "/",
        ),
      ],
      testTimeout: 120000,
    },
  };
});
