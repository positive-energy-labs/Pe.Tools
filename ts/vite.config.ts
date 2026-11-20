import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "**/dist/**",
      "**/dist-installed/**",
      "**/node_modules/**",
      "**/.artifacts/**",
      // Preserve the captured JSON and fixture bytes that the tests replay.
      "**/fixtures/**/*.json",
      "**/native-recordings/**/*.json",
      // tsr owns this file's shape and its dev watcher instantly reverts any reformat
      "**/routeTree.gen.ts",
      // host-typegen owns these checked-in artifacts; codegen:check compares exact bytes
      "**/host-ops.generated.ts",
      "**/host-catalog.generated.ts",
      "packages/host-contracts/src/generated/native-effect.generated.ts",
      // Canonical closure pins and SDK shape projections are compared byte-for-byte by their producers.
      "**/source-closure.generated.json",
      // Route and product codegen compare these projections byte for byte.
      "packages/agent-contracts/src/generated/route-directory.ts",
      "packages/agent-contracts/src/generated/command-axes.generated.ts",
      "packages/agent-contracts/src/routes/table.generated.ts",
      "apps/host/src/routes.generated.ts",
      "apps/host/src/product-executors.generated.ts",
      "apps/host/src/product-http.generated.ts",
      "packages/mcps/src/pea/guides.generated.ts",
      "packages/mcps/src/pea/product-actions.generated.ts",
      "packages/mcps/src/pea/product-catalog.generated.ts",
      "packages/mcps/src/pea/product-contracts.generated.ts",
      "**/pe-revit-wire.ts",
      // `pe-revit context product` writes this file ("DO NOT EDIT"); regeneration undoes any reformat
      "**/product.g.ts",
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
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "pe", specifier: "./scripts/oxlint-effect-edge.js" },
    ],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    // ADR 0029 rule 2: every fiber end in product code names its reason on the line.
    overrides: [{ files: ["apps/**", "packages/**"], rules: { "pe/effect-edge": "error" } }],
    options: { typeAware: true },
  },
  test: {
    exclude: [
      "**/node_modules/**", "**/dist-installed/**", "**/.artifacts/**",
      // DIAG-N03-REPORT.md: the intentionally red old-loader falsifier is retired with the legacy Families suite.
      "**/families/workflow.test.tsx",
    ],
    // A run from this folder (`vp test run apps/host/tests/x.test.ts`) uses this config, not the
    // package's. Without these it resolved the checkout's real state root and wrote test rows into
    // its notice file. Every package config names the same two files.
    globalSetup: ["./tests/isolated-home/global-setup.ts"],
    setupFiles: ["./tests/isolated-home/setup.ts"],
  },
  run: {
    cache: true,
  },
});
