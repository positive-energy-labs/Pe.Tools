import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    tsconfig: "tsconfig.build.json",
    entry: ["src/index.ts", "src/cli.ts", "src/keeper.ts"],
    dts: { tsgo: true },
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
  test: {
    globalSetup: ["../../tests/isolated-home/global-setup.ts"],
    setupFiles: ["../../tests/isolated-home/setup.ts"],
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
});
