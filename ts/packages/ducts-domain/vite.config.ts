import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
  test: {
    globalSetup: ["../../tests/isolated-home/global-setup.ts"],
    setupFiles: ["../../tests/isolated-home/setup.ts"],
  },
});
