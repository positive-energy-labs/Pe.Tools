import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type PluginOption } from "vite-plus";

export default defineConfig(({ mode }) => ({
  // Tailwind declares Vite's plugin type; Vite+ extends its recursive configuration type.
  plugins: tailwindcss() as PluginOption[],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  define: { "process.env.NODE_ENV": JSON.stringify(mode === "test" ? "test" : "production") },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
  },
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
}));
