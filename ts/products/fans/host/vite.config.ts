import base from "@pe/host/vite.config";
import { defineConfig } from "vite-plus";
import { fileURLToPath } from "node:url";
export default defineConfig(async env => {
  const config = await (typeof base === "function" ? base(env) : base);
  return { ...config, root: fileURLToPath(new URL("../../../apps/host/", import.meta.url)),
    test: { ...config.test, include: [fileURLToPath(new URL("./src/**/*.test.{ts,tsx}", import.meta.url)).replaceAll(String.fromCharCode(92), "/")] } };
});
