import { defineConfig } from "vite-plus";
import { browserGuardianPlugin } from "@pe/browser/build";
import { join } from "node:path";
import { receiptBuildDefines } from "../host/src/build-stamp.ts";

export default defineConfig({
  pack: {
    entry: ["src/main.ts"],
    outDir: "dist-installed/bundle",
    clean: ["dist-installed"],
    shims: true,
    plugins: [browserGuardianPlugin(join(import.meta.dirname, "dist-installed"))],
    define: {
      __PE_SOURCE_COMMIT__: receiptBuildDefines("release").__PE_SOURCE_COMMIT__,
    },
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
  // mcp.test.ts imports the host module graph (mcp-route -> receipt-export -> host-ownership),
  // which resolves PE_LANE at module load; declare the dev lane as the host's own tests do.
  test: {
    env: { PE_LANE: "dev" },
    globalSetup: ["../../tests/isolated-home/global-setup.ts"],
    setupFiles: ["../../tests/isolated-home/setup.ts"],
  },
});
