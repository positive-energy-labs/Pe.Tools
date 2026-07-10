import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "**/dist/**",
      "**/dist-installed/**",
      "**/node_modules/**",
      "**/.artifacts/**",
      // tsr owns this file's shape and its dev watcher instantly reverts any reformat
      "**/routeTree.gen.ts",
      // host-typegen owns this checked-in contract artifact; codegen:check compares exact bytes
      "**/host-ops.generated.ts",
    ],
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/dist-installed/**",
      "**/node_modules/**",
      "**/.artifacts/**",
    ],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist-installed/**", "**/.artifacts/**"],
  },
  run: {
    cache: true,
  },
});
