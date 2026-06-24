<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check --fix` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Pe.Tools TypeScript Workspace Decision

## Decision

`source/pe-tools` is the TypeScript workspace for Pe.Tools product-adjacent surfaces: user-facing `pea`, dev-only `peco`, local web/profile UI, protocol adapters, generated Host contracts, and small TypeScript libraries that make agent/UI/TUI work possible.

This workspace should use:

- pnpm workspaces for package linking and dependency ownership.
- Vite+ / `vp` for TypeScript app/package tasks, root lint/fmt/test policy, task graph execution, and bundle/package outputs.
- source exports for private internal workspace packages by default.
- dist outputs only at artifact boundaries: installed CLIs, frontend bundles, packaged runtime payloads, and any package that later becomes independently publishable.
- generated packages as generated projections from C# authority, with hand-maintained wrappers shielding app code from generated churn.

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

`pea` is the user product entrypoint. It may serve local protocols and standardized event/data formats for frontends, TUIs, and agents. It is not the semantic authority for Revit behavior, settings semantics, JSON schema generation, product layout, or Host operation contracts.

`peco` is private developer tooling. It can chain very specific Revit development workflows, RRD/live-loop checks, repo verification, and black-box Pea feedback. These commands should move out of the user-facing `pea` surface over time.

`@pe/runtime` is the shared protocol/runtime seam below both apps. It may expose generic `RuntimeFactory`, auth, session, event, ACP, and AG-UI contracts, but it should not dispatch on Pea-vs-`peco` product identity.

Pea's Mastra workspace root and product home are the same directory. By default this is the directory where the Pea CLI is launched; `--workspace-root` may override it. Pea should operate inside that product workspace, while scripting tools can continue to default to the Host/Revit scripting workspace key such as `workspaces/default`.

## Authority Model

TypeScript is the bridge and presentation/runtime layer for things that are impractical in C#: agent runtimes, protocol adapters, browser UI, TUI, and local frontend orchestration.

Semantic authority remains in the existing Pe.Tools layers:

- `Pe.Shared.HostContracts` owns public Host operation contracts, DTOs, operation metadata, and generated projections.
- `Pe.Host` owns the local HTTP/SSE operation surface and process/lifecycle bridge to local product capabilities.
- `Pe.Shared.StorageRuntime` owns settings storage, JSON schema generation, schema definitions, validation, field options, and authored document behavior.
- `Pe.Revit.*` packages own Revit document/session behavior and live Revit semantics.
- generated TypeScript packages are projections from those authorities, not independent source truth.

The intended flow is:

```text
UI / TUI / agent / CLI
  -> pea or peco TypeScript runtime
  -> local wrappers over generated Host contracts
  -> Pe.Host public operations
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
- bundled `peco` artifacts if a built private artifact is useful;
- web/frontend production bundles;
- package outputs that are intentionally consumed outside the workspace;
- any future package whose default import shape must match installed/published runtime behavior.

For source-exported packages that still need package artifacts, keep `package.json` exports pointed at `src` and set an explicit Vite+ `pack.entry` in `vite.config.ts`. Do not use `pack.exports: true` for private source-export packages; it rewrites package exports back to `dist`.

When non-source exports are needed, use custom export conditions instead of `tsconfig.paths`, typescript project references, pnpm `publishConfig` rewrites, etc. ctrl + click to go to definition is indispensible.

## Generated Code Policy

Generated TypeScript is a projection from C# authority.

`host-generated` or equivalent should contain generated DTOs, operation catalogs, and typed client slices. App code should avoid importing generated shapes directly unless there is no useful wrapper yet.

Hand-maintained wrappers belong in a separate normal source package, such as `host-client`, and should absorb generated contract churn behind stable local calls.

Preferred app dependency direction:

```text
app code
  -> host-client wrappers
  -> host-generated projections
  -> Pe.Host operations
```

Avoid spreading generated import paths across runtime, UI, and tool code. Generated code should be easy to delete and regenerate without changing product code that only cares about stable local concepts.

## Pea And Local UI Posture

`pea` may serve localhost browser UI and protocol endpoints. For now, localhost-only UI is preferred over hosted UI because it reduces version/contract drift while the Host contracts and schema/UI contracts are still evolving.

The browser UI should be presentation/controller only:

- render schemas and field metadata;
- call local `pea`/Host-backed operations;
- read/write profiles through local authority;
- display validation diagnostics and artifacts;
- avoid owning Revit or settings semantics.

Even without a full account/session system, local UI should avoid accidental exposure. Bind to loopback by default and require a local connection token when exposing HTTP/SSE endpoints. Treat that token as localhost plumbing, not Pea Cloud or user identity auth; product-served URLs should use per-launch tokens, while explicit dev loops may use a fixed token only for matching local proxy setup.

Pea Cloud, WorkOS, Mastra Gateway, sponsored model access, and Gateway-backed observational memory remain product goals, but they must be lazy capabilities. Local workbench startup, thread browsing, local provider-key model access, and Revit/operator dev loops should not require cloud login; use explicit local-only/no-cloud-auth controls when cloud auth would add friction.

## Pea TUI Live Loop

`pea beta-tui` must prioritize a usable prompt loop over OpenTUI polish. On the current Windows + zellij path, OpenTUI rendering can prevent zellij-injected stdin from reaching the app even when plain raw stdin panes work. Until that backend issue is resolved, keep `pea beta-tui` defaulting to the line workbench and treat OpenTUI as an opt-in/fallback-rendering experiment.

When proving the beta TUI, use the Pea black-box product lane through the actual PATH command, not a lower-level source runner: launch with `zellij run --cwd <repo> --name pea-beta-tui -- pea beta-tui`, drive input with `zellij action write-chars -p <pane>` plus `zellij action send-keys -p <pane> Enter`, and verify with `zellij action dump-screen -p <pane>`. The minimum proof is startup showing threads, a prompt returning `[done: end_turn]`, `/refresh` updating thread state, and `/load <n|id>` changing the active thread header.
