import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/main.ts"],
    outDir: "dist-installed/bundle",
    clean: ["dist-installed"],
    shims: true,
    deps: {
      alwaysBundle: [/./],
      onlyBundle: false,
    },
    loader: {
      ".wasm": "base64",
      ".scm": "text",
    },
    exe: {
      fileName: "pea",
      outDir: "dist-installed",
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
