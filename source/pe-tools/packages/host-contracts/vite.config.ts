import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/contracts/index.ts", "src/effect/host-effect.generated.ts"],
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
  fmt: {},
});
