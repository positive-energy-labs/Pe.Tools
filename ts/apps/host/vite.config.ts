import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    outDir: "dist-installed/bundle",
    clean: ["dist-installed"],
    shims: true,
    plugins: [
      {
        name: "preserve-node-socket-context",
        transform: {
          filter: { id: /@effect\/platform-node-shared\/dist\/NodeSocket\.js$/ },
          // Rolldown drops Context while retaining the unused NetSocket superclass call.
          handler: () => ({ moduleSideEffects: "no-treeshake" }),
        },
      },
    ],
    deps: {
      alwaysBundle: [/./],
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
  // Unit tests import the host module graph directly (not via the source entry points), so
  // ensure-source-lane.ts does not run — declare the dev lane here so resolveHostLane's PE_LANE
  // fail-fast (IPC-SEAM-SPEC D7) sees a valid signal instead of throwing at module load.
  // Host boundary scenarios claim the same source service identity; parallel files would make
  // one test take over another test's server instead of testing either lifecycle.
  test: { env: { PE_LANE: "dev" }, fileParallelism: false },
});
