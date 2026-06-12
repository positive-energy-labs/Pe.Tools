import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
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
