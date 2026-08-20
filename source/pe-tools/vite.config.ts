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
      // Pe.Revit.Sdk owns these files byte-for-byte and `pe-revit doctor`'s ts-client-drift check
      // compares them to the copies embedded in the CLI. Reformatting one IS drift: the check goes
      // red and the remedy is "re-copy clients/ts from the Pe.Revit.Sdk package", which undoes the
      // reformat every time. They are vendored, not authored here.
      "**/pe-revit-cli.ts",
      "**/pe-service.ts",
      "**/pe-service-host.ts",
      "**/pe-revit-contract.ts",
    ],
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/dist-installed/**",
      "**/node_modules/**",
      "**/.artifacts/**",
      // Same reason as fmt: SDK-owned bytes. Its generated-code style is not ours to lint.
      "**/pe-revit-cli.ts",
      "**/pe-service.ts",
      "**/pe-service-host.ts",
      "**/pe-revit-contract.ts",
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
