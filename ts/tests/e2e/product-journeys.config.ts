import base from "./product-composition.config.ts";
import { defineConfig } from "vite-plus";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Mounted journeys a product keeps in its own `web/journeys/`, over the fixture host.
const journeys = (include: URL) =>
  defineConfig(async (env) => {
    const config = await (typeof base === "function" ? base(env) : base);
    const root = config.root ?? import.meta.dirname;
    // A product runs this config from its own folder, so the setup paths cannot stay relative.
    const absolute = (files: string | string[] = []) =>
      [files].flat().map((file) => resolve(root, file));
    return {
      ...config,
      test: {
        ...config.test,
        setupFiles: absolute(config.test?.setupFiles),
        globalSetup: absolute(config.test?.globalSetup),
        include: [fileURLToPath(include).replaceAll("\\", "/")],
        testTimeout: 60000,
      },
    };
  });

/** One product's runner: the journeys in the `journeys/` folder beside its config file. */
export const productJourneys = (config: string) =>
  journeys(new URL("./journeys/*.journey.test.tsx", config));

export default journeys(
  new URL("../../products/*/web/journeys/*.journey.test.tsx", import.meta.url),
);
