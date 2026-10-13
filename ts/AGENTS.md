<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `pnpm verify` before claiming a change is done. It is the only proof entrypoint; CI runs the same command.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Pe.Tools TypeScript Workspace Decision

## Decision

`ts` is the TypeScript workspace for Pe.Tools product-adjacent surfaces: user-facing `pea`, generated Host contracts, and small TypeScript libraries that make agent/TUI work possible.

This workspace should use:

- pnpm workspaces for package linking and dependency ownership.
- Vite+ / `vp` for TypeScript app/package tasks, root lint/fmt/test policy, task graph execution, and bundle/package outputs.
- source exports for private internal workspace packages by default.
- dist outputs only at artifact boundaries: installed CLIs, frontend bundles, packaged runtime payloads, and any package that later becomes independently publishable.
- generated packages as generated projections from C# authority, with app-local callers or generated RPC surfaces shielding app code from generated churn.

The default internal package shape is:

```json
{
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  }
}
```

This is a private-product monorepo posture, not a public npm package ecosystem posture.

Names may change, but the authority boundaries should not blur.

`pea` is the user product entrypoint. It is a thin CLI over the host: `pea --prompt` runs one headless turn on a harness thread, and the lab harness (Claude Code or Codex, ADR 0015) owns the loop and inference. It is not the semantic authority for Revit behavior, settings semantics, JSON schema generation, product layout, or Host operation contracts.

There is no separate dev agent surface anymore (`peco` was deleted): the SDK `pe-revit` CLI/MCP owns execution-loop and test mechanics, the `pea` MCP server owns product tools, and `pea --prompt` is the headless black-box Pea probe.

`@pe/runtime` is the thin shared runtime helper package below Pea and tooling. Keep it limited to route-workspace state, resource streams, and analytics that need Pe-owned policy. Do not rebuild harness loop, model, mode, thread, or ACP surfaces here; those live in `apps/host/src/harness/`.

The harness child's cwd (the world root) is the product home (`productHomePath` in `@pe/host-contracts/product-paths`: `PE_TOOLS_PRODUCT_HOME`, else `Documents\Pe.Tools`; the Revit side reads the same variable). Pea operates inside that product workspace, while scripting tools can continue to default to the Host/Revit scripting workspace key such as `workspaces/default`.

## Authority Model

TypeScript is the bridge and presentation/runtime layer for things that are impractical in C#: agent runtimes, TUI, generated Host RPC surfaces, and local orchestration.

Semantic authority remains in the existing Pe.Tools layers:

- `Pe.Shared.HostContracts` owns public Host operation contracts, DTOs, operation metadata, and generated projections.
- the TypeScript Host owns the local Effect RPC operation surface and process/lifecycle bridge to local product capabilities.
- `Pe.Shared.StorageRuntime` owns C# storage roots, module/document identity, runtime state/output/log files, APS settings lookup, and small settings metadata contracts.
- `Pe.Revit.SettingsRuntime` owns Revit-authored JSON schema generation, schema definitions, validation, field options, and typed settings reads over the TS host document runtime.
- `Pe.Revit.*` packages own Revit document/session behavior and live Revit semantics.
- generated TypeScript packages are projections from those authorities, not independent source truth.

The intended flow is:

```text
TUI / agent / CLI
  -> pea TypeScript runtime
  -> app-local callers or generated Host RPCs over generated Host contracts
  -> TypeScript Host public operations
  -> shared C# contracts / Revit packages / storage runtime
```

## Why Source Exports?

Most TypeScript packages in this workspace are private, repo-local modules. Their purpose is modular design, not npm publication.

Source exports make that explicit:

- internal imports see current source without stale `dist`;
- Vite, Vitest, tsx-like execution, and app builds can consume the same source graph;
- package boundaries remain real package boundaries instead of ad hoc `tsconfig.paths`;
- generated wrappers and runtime seams can be factored without introducing watch-build requirements;
- the workspace stays closer to application development than library release engineering.

Dist-first remains appropriate for:

- installed `pea` payloads;
- web/frontend production bundles;
- package outputs that are intentionally consumed outside the workspace;
- any future package whose default import shape must match installed/published runtime behavior.

For source-exported packages that still need package artifacts, keep `package.json` exports pointed at `src` and set an explicit Vite+ `pack.entry` in `vite.config.ts`. Do not use `pack.exports: true` for private source-export packages; it rewrites package exports back to `dist`.

When non-source exports are needed, use custom export conditions instead of `tsconfig.paths`, typescript project references, pnpm `publishConfig` rewrites, etc. ctrl + click to go to definition is indispensible.

## Generated Code Policy

Generated TypeScript is a projection from C# authority.

`host-contracts` or equivalent should contain generated DTOs, operation catalogs, schemas, and eventually typed RPC surfaces. App code may import generated contracts directly at operation/UI boundaries when that is the simplest way to keep type coupling explicit.

Do not reintroduce a hand-maintained Host wrapper package. Temporary app-local or tools-local callers are acceptable until generated Effect RPC surfaces replace them.

Preferred app dependency direction:

```text
app code
  -> generated Host RPCs or app-local callers
  -> host-contracts projections
  -> TypeScript Host operations
```

Avoid spreading generated import paths into unrelated runtime policy. Generated code should be easy to delete and regenerate without leaving stale files behind.

## Pea UI Posture

The browser chat renders the host's harness thread SSE stream (ADR 0015). Do not restore a Pe-owned agent loop or a second protocol adapter beside ACP.

Pea Cloud, WorkOS, and sponsored model access remain product goals, but they must be lazy capabilities. Host startup, thread browsing, subscription or endpoint-provider model access, and Revit/operator dev loops should not require cloud login; use explicit local-only/no-cloud-auth controls when cloud auth would add friction.

## Pea TUI dev loop

`pea beta-tui` must prioritize a usable prompt loop over OpenTUI polish. On the current Windows + zellij path, OpenTUI rendering can prevent zellij-injected stdin from reaching the app even when plain raw stdin panes work. Until that backend issue is resolved, keep `pea beta-tui` defaulting to the line workbench and treat OpenTUI as an opt-in/fallback-rendering experiment.

When proving the beta TUI, use the Pea black-box product lane through the actual PATH command, not a lower-level source runner: launch with `zellij run --cwd <repo> --name pea-beta-tui -- pea beta-tui`, drive input with `zellij action write-chars -p <pane>` plus `zellij action send-keys -p <pane> Enter`, and verify with `zellij action dump-screen -p <pane>`. The minimum proof is startup showing threads, a prompt returning `[done: end_turn]`, `/refresh` updating thread state, and `/load <n|id>` changing the active thread header.
