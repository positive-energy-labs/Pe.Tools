import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type PluginOption } from "vite-plus";

export default defineConfig({
  // Tailwind declares Vite's plugin type; Vite+ extends its recursive configuration type.
  plugins: tailwindcss() as PluginOption[],
  resolve: {
    alias: { "#": fileURLToPath(new URL("../../apps/web/src", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    lib: {
      entry: "src/browser.ts",
      name: "PeKit",
      formats: ["iife"],
      fileName: () => "pe-kit.js",
      cssFileName: "pe-kit",
    },
    cssCodeSplit: false,
    sourcemap: false,
  },
});
