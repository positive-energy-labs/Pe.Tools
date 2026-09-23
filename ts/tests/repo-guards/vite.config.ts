import { defineConfig } from "vite-plus";

export default defineConfig({
  // Guards run one file at a time: a parallel run starved the AST-walking guards past their
  // 5 s timeout while the long pole ran (crusade review 2026-09-22, signal 1).
  test: { fileParallelism: false },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
