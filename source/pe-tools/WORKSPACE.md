# Pe.Tools TypeScript Workspace Decision

## Decision

`source/pe-tools` is the TypeScript workspace for Pe.Tools product-adjacent surfaces: user-facing `pea`, private `pe-code`, local web/profile UI, protocol adapters, generated Host contracts, and small TypeScript libraries that make agent/UI/TUI work possible.

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

## Intended Package Boundaries

The workspace should separate runtime authority from app entrypoints without moving Pe.Tools semantics into TypeScript.

Expected high-level shape:

```text
source/pe-tools/
  apps/
    pea/              # installed user CLI, TUI, local UI/protocol server
    pe-code/          # private repo/Revit development agent and workflow runner
    profile-ui/       # local browser UI for settings/profile authoring

  packages/
    runtime/          # protocol-neutral runtime/session/event seams
    host-generated/   # generated Host types/catalog/client only
    host-client/      # hand wrappers over generated Host calls
    schema-runtime/   # JSON schema/document helper logic for TS consumers
    schema-ui/        # UI-facing schema view models/components/helpers
    pea-tools/        # user/operator-safe product tools
    pe-code-tools/    # repo/RRD/build/dev-loop-only tools
```

Names may change, but the authority boundaries should not blur.

`pea` is the user product entrypoint. It may serve local protocols and standardized event/data formats for frontends, TUIs, and agents. It is not the semantic authority for Revit behavior, settings semantics, JSON schema generation, product layout, or Host operation contracts.

`pe-code` is private developer tooling. It can chain very specific Revit development workflows, RRD/live-loop checks, repo verification, and black-box Pea feedback. These commands should move out of the user-facing `pea` surface over time.

`@pe/runtime` is the shared protocol/runtime seam below both apps. It may expose generic `RuntimeFactory`, auth, session, event, ACP, and AG-UI contracts, but it should not dispatch on Pea-vs-`pe-code` product identity. Pea and `pe-code` each own their native Harness configuration and product policy in their app packages, then inject a runtime factory into shared protocol adapters.

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
  -> pea or pe-code TypeScript runtime
  -> local wrappers over generated Host contracts
  -> Pe.Host public operations
  -> shared C# contracts / Revit packages / storage runtime
```

## Why Source Exports Are The Default

Most TypeScript packages in this workspace are private, repo-local modules. Their purpose is modular design, not npm publication.

Source exports make that explicit:

- internal imports see current source without stale `dist`;
- Vite, Vitest, tsx-like execution, and app builds can consume the same source graph;
- package boundaries remain real package boundaries instead of ad hoc `tsconfig.paths`;
- generated wrappers and runtime seams can be factored without introducing watch-build requirements;
- the workspace stays closer to application development than library release engineering.

This is closest to the practical shape observed in `source/repos/t3code`: private product packages export `./src/*.ts`, apps depend on them through `workspace:*`, and Vite+ handles app/build/test orchestration. That repo is the better local precedent because Pe.Tools TS is also primarily product/app infrastructure, not a broad public package suite.

## Why Dist-First Is Not The Default

The initialized Vite+ `packages/utils` template currently exports `./dist/index.mjs` and builds with `vp pack`. That is a publishable-library template, not the desired default for Pe.Tools internal packages.

Dist-first remains appropriate for:

- installed `pea` payloads;
- bundled `pe-code` artifacts if a built private artifact is useful;
- web/frontend production bundles;
- package outputs that are intentionally consumed outside the workspace;
- any future package whose default import shape must match installed/published runtime behavior.

Dist-first is not appropriate for ordinary internal modularization because it creates stale-output risk and watch-build friction without buying meaningful product safety.

Mastra is the counterexample. Mastra uses pnpm plus Turbo and mostly dist-first package exports because it is a large public package ecosystem with many independently publishable packages, dual ESM/CJS outputs, generated declaration/runtime artifacts, and npm-facing compatibility constraints. Pe.Tools should not copy that wholesale because Pe.Tools TS packages are mostly private adapters over local Host/Revit authority.

## Why Custom Export Conditions Are Deferred

Custom source conditions are the best general-purpose model when one package needs both:

- live source inside the monorepo; and
- production-shaped default `dist` exports for installed or published consumers.

That model is more precise than pnpm `publishConfig` rewrites and can keep TypeScript, Vite, and runtime resolution aligned when configured consistently.

It is not the starting default here because most packages do not yet have a dual identity. Adding custom conditions everywhere would add ceremony before the need exists.

Use custom export conditions later for packages that truly need both dev-source and production-dist behavior, such as a shared protocol package, schema runtime package, or host client package if it becomes a separately versioned artifact.

## Why pnpm `publishConfig` Rewrites Are Not Used

The pnpm live-source / publish-rewrite pattern is not the desired architecture.

Reasons:

- it is pnpm-specific behavior and easy to misread with npm tooling;
- it hides a source-vs-published rewrite in package-manager behavior rather than an explicit runtime condition;
- Pe.Tools already has complex build/runtime/proof lanes, so hidden publication behavior would make validation harder;
- most packages are private and do not need publish-time rewrites at all.

`publishConfig` may still exist for normal package metadata such as access, registry, or publish policy. It should not be the mechanism that changes internal package resolution from source to dist.

## Why `tsconfig.paths` Is Not The Package Model

`tsconfig.paths` may be acceptable for app-local conveniences such as `~/*`, but it should not define workspace package identity.

Reasons:

- TypeScript path mapping does not by itself define Node/Vite/package runtime resolution;
- it can create static/runtime disagreement;
- it weakens package boundaries by making imports look global rather than package-owned;
- it does not scale well for generated packages and app wrappers where package-level ownership is useful.

Use real workspace packages and `workspace:*` edges for shared code. Use app-local aliases sparingly and only when they stay inside one app.

## Why TypeScript Project References Are Deferred

Project references do not solve runtime import resolution. They are a TypeScript build/editor scaling tool.

Do not introduce them until there is evidence that typecheck/editor performance requires them. If that happens, add them as a performance layer over the package graph, not as the primary modularity model.

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

Even without a full auth/session system, local UI should avoid accidental exposure. Bind to loopback by default and prefer a per-launch local token when exposing HTTP/SSE endpoints.

## Command Surface Policy

Installed/user-facing `pea` should keep one obvious entrypoint for product work.

### CLI Composition Policy

Apps own executable identity, audience defaults, root command posture, and artifact entrypoint behavior only. Capability packages own the Gunshi command modules for the behavior they own. Deterministic capability cores should sit below both Mastra tool adapters and Gunshi command adapters so agent tools and CLI commands do not duplicate implementation.

`pea` is the product/operator-facing CLI. It may expose Pea product tools including Host status/logs/operations, scripts, product UI, and product runtime commands. Scripting is intentionally product-visible because each CLI should be able to expose the same agent tools it owns through human-facing CLI commands.

`pe-code` is the repo/dev-facing CLI. It owns repo-source, RRD/live-loop, verification, codegen, dev-agent, and black-box Pea feedback commands. Dev workflows should not route through `pea`.

`pea dev` should disappear rather than become a long-term alias. If a transition bridge is ever required, keep it temporary and hidden; the durable command identity is `pe-code`.

Both CLIs are human-facing by default. `--json` output may be added selectively where it improves debugging or automation, but universal JSON parity is not required for this migration spike.

Candidate user-facing surface:

```text
pea agent
pea ui
pea host status
pea host logs
pea profile ...
pea script ...      # only if scripting is intentionally user-visible
```

Private developer workflow should move to `pe-code`:

```text
pe-code
pe-code live ...
pe-code rrd ...
pe-code test ...
pe-code codegen ...
pe-code talk-to-pea ...
pe-code sync ...
```

`pea dev` is not the repo-source development command. It should disappear; `pe-code` is the durable command identity for repo/dev posture.

## Relationship To Observed Repos

### t3code

t3code is the closer precedent:

- pnpm workspace;
- Vite+ root configuration and `vp run` orchestration;
- private packages exporting `./src/*.ts`;
- app/product repo posture;
- source-first ergonomics over dist-first package fidelity.

Pe.Tools should copy the broad posture, not the exact structure. Pe.Tools has stronger C# authority, installer/runtime lanes, Revit proof lanes, generated Host contracts, and an existing product CLI split. Those constraints matter more than matching t3code folder names.

### Mastra

Mastra is the useful counterexample:

- pnpm workspace;
- Turbo graph execution;
- many packages exporting `dist`;
- publishable package ecosystem;
- dual output/declaration/release concerns.

Pe.Tools should not copy Mastra as the default because Pe.Tools TypeScript packages are not primarily independently published npm packages. Mastra-style dist-first output should be reserved for Pe.Tools artifact boundaries, not every internal workspace package.

## Stable Rule

Choose the package resolution model from the package's authority and audience:

| Package kind                                                | Default resolution                                    |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| Private internal helper/runtime package                     | Source exports                                        |
| Generated C# contract projection                            | Source exports while private; regenerated, not edited |
| Hand wrapper over generated contracts                       | Source exports                                        |
| Installed CLI/app/runtime payload                           | Built artifact                                        |
| Frontend production app                                     | Built artifact                                        |
| Future independently published package                      | Dist-first or custom export condition                 |
| Package needing live-source dev and production-dist default | Custom export condition                               |

Do not make every package prove publication discipline just to get modular design.
