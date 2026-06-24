import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

const reactPlugin = react();
const tailwindPlugin = tailwindcss();
const workbenchDevToken = process.env.PE_WORKBENCH_DEV_TOKEN ?? "dev-loopback";

export default defineConfig({
  plugins: [reactPlugin as never, tailwindPlugin as never],
  server: {
    proxy: {
      "/workbench": {
        target: process.env.PE_WORKBENCH_AGENT_URL ?? "http://127.0.0.1:43112",
        changeOrigin: true,
        // Vite dev targets the matching `pea dev:web` / `peco dev:web` fixed local token.
        // Served-app flows still carry the per-launch token through URL params instead.
        headers: { "x-runtime-workbench-token": workbenchDevToken },
      },
      "/api/workbench": {
        target: process.env.PE_WORKBENCH_API_URL ?? "http://127.0.0.1:43113",
        changeOrigin: true,
      },
    },
  },
  build: {},
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
