import base from "@pe/web/vite.config";
import { defineConfig } from "vite-plus";
import { fileURLToPath } from "node:url";
export default defineConfig(async env => {
  const config = await (typeof base === "function" ? base(env) : base);
  return { ...config, root: fileURLToPath(new URL("../../../apps/web/", import.meta.url)),
    // vp's task graph resolves every package with its own root; application build plugins belong to apps/web.
    plugins: env.mode === "test" ? config.plugins : [],
    test: { ...config.test, include: [fileURLToPath(new URL("./src/**/*.test.{ts,tsx}", import.meta.url)).replaceAll(String.fromCharCode(92), "/")] } };
});
