import base from "../../../tests/e2e/product-journeys.config.ts";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig(async (env) => {
  const config = await (typeof base === "function" ? base(env) : base);
  const root = config.root ?? import.meta.dirname;
  const absolute = (files: string | string[] = []) =>
    [files].flat().map((file) => resolve(root, file));
  return {
    ...config,
    test: {
      ...config.test,
      setupFiles: absolute(config.test?.setupFiles),
      globalSetup: absolute(config.test?.globalSetup),
      include: [
        fileURLToPath(new URL("./journeys/*.journey.test.tsx", import.meta.url)).replaceAll(
          "\\",
          "/",
        ),
      ],
    },
  };
});
