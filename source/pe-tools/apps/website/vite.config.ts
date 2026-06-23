import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

const reactPlugin = react();
const tailwindPlugin = tailwindcss();

export default defineConfig({
  plugins: [reactPlugin as never, tailwindPlugin as never],
  server: {
    proxy: {
      "/workbench": {
        target: process.env.PE_WORKBENCH_AGENT_URL ?? "http://127.0.0.1:43112",
        changeOrigin: true,
        // Dev loop injects the backend's fixed token; the served-app flow uses URL params instead.
        headers: process.env.PE_WORKBENCH_DEV_TOKEN
          ? { "x-runtime-workbench-token": process.env.PE_WORKBENCH_DEV_TOKEN }
          : undefined,
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
