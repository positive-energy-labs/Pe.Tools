import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    outDir: "dist-installed/bundle",
    clean: ["dist-installed"],
    shims: true,
    deps: {
      alwaysBundle: [/./],
      neverBundle: [
        /^@duckdb\/node-bindings-win32-x64/,
        /^@anush008\/tokenizers-win32-x64-msvc/,
        /^@libsql\/win32-x64-msvc/,
      ],
      onlyBundle: false,
    },
    loader: {
      ".wasm": "base64",
      ".scm": "text",
    },
    exe: {
      fileName: "Pe.Host",
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
