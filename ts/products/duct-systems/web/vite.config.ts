import base from "../../../apps/web/vite.config.ts";
import { defineConfig } from "vite-plus";
import { fileURLToPath } from "node:url";
export default defineConfig(async env => {
  const config = await (typeof base === "function" ? base(env) : base);
  return { ...config, root: fileURLToPath(new URL("../../../apps/web/", import.meta.url)),
    test: { ...config.test, include: [fileURLToPath(new URL("./**/*.test.{ts,tsx}", import.meta.url)).replaceAll(String.fromCharCode(92), "/")] } };
});
