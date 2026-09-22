import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: "src/index.ts",
    dts: {
      tsgo: true,
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  // schedule-callers.test.ts drives the real host fixture, whose module graph resolves the host
  // lane at import; PE_LANE is the SDK-owned signal and the host refuses to guess it.
  test: { env: { PE_LANE: "dev" } },
  fmt: {},
});
