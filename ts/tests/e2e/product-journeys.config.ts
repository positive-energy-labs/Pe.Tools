import base from "./product-composition.config.ts";
import { defineConfig } from "vite-plus";
import { fileURLToPath } from "node:url";

// Mounted journeys a product keeps in its own `web/journeys/`, over the fixture host.
export default defineConfig(async (env) => {
  const config = await (typeof base === "function" ? base(env) : base);
  return {
    ...config,
    test: {
      ...config.test,
      include: [
        fileURLToPath(new URL("../../products/*/web/journeys/*.journey.test.tsx", import.meta.url)).replaceAll(
          "\\",
          "/",
        ),
      ],
      testTimeout: 60000,
    },
  };
});
