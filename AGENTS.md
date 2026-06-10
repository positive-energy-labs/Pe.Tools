---
alwaysApply: true
---

# Pe.Tools

## Scope

Repo-wide agent guidance for conventions, current paths, validation habits, Revit workflow constraints, and cross-package terminology that repeatedly matters across the codebase.

## The Gist

This repo exists to improve Engineering Designer workflows for MEP firms through strongly typed, debuggable Revit tooling. These documents are the lynchpins:

- `docs/ARCHITECTURE.md` - read before multi module changes, debugging, and code review. Contains target architecture; code should always seek to align.
- `docs/BUILD.md` - read before changing anything build, deploy, or dev-loop related. Contians repo tooling justification and explanation. Always prove (or disprove) before changing the document. Information here is mission critical.

This repo is greenfield: move fast, prefer the best long-term shape, and do not preserve compatibility shims unless they are a temporary compile bridge. Code style should optimize for linear execution flow, fail-fast behavior, composable systems, and wrappers around finicky Revit API behavior.

## TLDRs

`BUILD.md` is the canonical repo guide for build, runtime, package, install, and Revit proof lanes.

- Keep terminal compile/package proof separate from live-runtime freshness.
- Protect the current RRD session aggressively. Breaking it can turn a small edit into a multi-minute restart plus document reopen wait.
- Use the `pea live <sync/restart/status>` commands for RRD-safe live-looping if harness alternatives are not available.

## Critical Entry Points

- `source/Pe.App/Application.cs` - desktop Revit add-in startup, host bridge bootstrap, ribbon/task initialization.
- `source/Pe.App/ButtonRegistry.cs` - top-level desktop command and ribbon exposure.
- `source/Pe.Host/Program.cs` - external settings host, HTTP/SSE entrypoint.
- `source/pea/app/` - TypeScript Pea CLI/runtime surface. `pea agent` is the deployed Revit/operator workbench; `peco` starts Peco, the MastraCode-based repo coding agent with Pea black-box feedback tools.
- `source/Pe.Shared.StorageRuntime/` - schema generation, field options, module registration, storage/document validation.
- `source/Pe.Revit.Global/` - document-owned Revit helpers, APS contracts, and DA-safe collector seams that both shells can share.
- `source/Pe.Revit/Extensions/` - strong primitives such as `FamilyDocument`, value coercion helpers, formula helpers, and parameter lookup helpers.
- `source/Pe.Revit.FamilyFoundry/OperationProcessor.cs` - main Family Foundry execution orchestrator.
- `docs/features/family-foundry/_DEV.md` and `_GOALS.md` - Family Foundry architecture and intent.

## Shared Language

### Runtime / iteration language

| Term    | Meaning                                                                                   | Prefer / Avoid                                                                                 |
| ------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **RRD** | The live Rider-driven Revit debug session for `Pe.App`. Treat it as expensive state.      | Prefer this over vague phrases like `live debug`; avoid implying hot reload exists outside RRD |
| **HR**  | Rider hot reload into the already-running RRD session. Useful, but not fully trustworthy. | Avoid treating HR as proof that Revit is running fresh code                                    |

### Repo-wide language

| Term                  | Meaning                                                                                  | Prefer / Avoid                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **FF**                | Family Foundry                                                                           | Prefer `Family Foundry` on first mention in prose                                            |
| **workflow**          | The operator intent such as build, verify, package, or publish                           | Prefer this over overloading `Configuration` strings to carry every concern                  |
| **execution policy**  | Whether a workflow is allowed to touch `RRD`                                             | Prefer explicit `NoRrdContact` / `RrdRequired` language over vague safety assumptions        |
| **AttachedRrd**       | Verification against the already-running Rider-driven desktop Revit session              | Prefer this over vague `live tests` phrasing when the running session itself matters         |
| **FreshRevitProcess** | Verification in a new dedicated Revit process that must not reuse `RRD`                  | Prefer this over vague `isolated tests` phrasing when freshness and process ownership matter |
| **package**           | A repo-local code unit such as `Pe.Host` or `Pe.Revit.FamilyFoundry`                     | Prefer this over `project` when discussing one code area                                     |
| **app**               | `Pe.App`, the in-proc desktop Revit add-in runtime                                       | Avoid using `app` to mean the whole repo or product                                          |
| **host**              | `Pe.Host`, the out-of-proc HTTP/SSE backend                                              | Avoid using `host` for the Revit add-in bridge or product identity                           |
| **bridge**            | The private Host/Revit WebSocket connection                                              | Avoid calling HTTP endpoints the bridge                                                      |
| **automation shell**  | The headless DA runtime rooted in `Pe.Dev.RevitAutomation.Worker`                        | Prefer this over implying `Pe.App` itself runs in DA                                         |
| **document-owned**    | Behavior that can be derived from a specific `Document` without needing UI session state | Prefer `Document` extensions for this                                                        |
| **document session**  | Open/active/UI-tab state for documents in the current Revit process                      | Keep this in `UIApplication` or session-aware helpers                                        |
| **artifact**          | A durable machine-readable output produced by a command or DA workitem                   | Prefer this over vague `report` when the file is the actual output contract                  |
| **workitem**          | One APS Design Automation job submission                                                 | Prefer one workitem per cloud model for batch collection                                     |

### Portable Revit state language

| Term           | Meaning                                                                            | Prefer / Avoid                                                           |
| -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **collect**    | Read live Revit state into a transient catalog, list, or query result              | Prefer this for live-document queries                                    |
| **capture**    | Convert live Revit state into a durable snapshot or spec                           | Prefer this when the output survives document/session/version boundaries |
| **snapshot**   | Durable captured point-in-time state with provenance when needed                   | Avoid using it as the umbrella term for every derived output             |
| **projection** | A target-shaped derived output such as a matrix, dataset, CSV, or profile fragment | Prefer this for derived output shapes                                    |
| **apply**      | Write compatible authored or captured state back into live Revit                   | Prefer this over `replay` for patch/merge oriented behavior              |
| **profile**    | The top-level authored settings document that drives a command or workflow         | Avoid using it as a synonym for snapshot output                          |

## Living Memory

- Minimize API surface area. Favor type-safety, nullability correctness, generics, `nameof`, pattern matching, and small explicit contracts.
- Prefer `Result<T>` / `Try...` patterns on public or user-facing flows instead of exceptions when failure is expected.
- Use Serilog `Log.*` instead of `Console.WriteLine` or `Debug.WriteLine` in runtime code.
- Prefer LINQ, fluent APIs, and extracted helpers over deep nesting. Keep execution flow easy to debug.
- Treat desktop and DA as sibling shells over shared DA-safe runtime packages. Do not route DA through `Pe.App` startup.
- DA-safe collector paths must not depend on `UIApplication`, WPF, ribbon helpers, or interactive session services. Keep those in UI-specific packages and helpers.
- Put document-owned identity, path, binding, and collection helpers on `Document` extensions as close to `Pe.Revit` as possible. Keep open/active/navigation behavior in session-aware services or `UIApplication` extensions.
- Prefer `Document` / `FamilyDocument` as the public entrypoints for document-owned collect/capture/apply flows, even when the returned models still live in a feature package.
- When validating DA collection performance, start narrow and bounded. Category filters are a verification tool, not just a product feature.

## Outstanding Guidance to Add

- WPF BAML resolution errors that occasionally happen. This remains a major blocker, but cause and durable mitigation are still unknown.

<!-- Peco managed instructions:start -->

# Peco

Peco is the Pe.Tools repo coding agent built on Mastra Harness/Workspace primitives. Pea is the deployed Revit/operator workbench. Keep the boundary clear: use Pea only as a black-box product harness, never as a repo-source agent.

## Core Operating Loop

Clarify user intent and explicate assumptions
=> Make changes
=> Verify if needed
=> Capture durable and prune stale knowledge

## Keep the Harness Small

Always-loaded instructions own only invariants and routing. Detailed loops belong in project skills. If a workflow grows large or repeats, route to the matching skill or improve that skill instead of expanding this block.

Core invariants:

- Keep Pea free of repo-source posture, build topology, RRD/Rider assumptions, and repo-only skills.
- Use ordinary source workflows for repo work: inspect code, edit focusedly, verify with the narrowest meaningful proof.
- Keep terminal compile/package proof separate from live Revit runtime freshness and always assume that assemblies are stale before testing, scripting, or using Pea.
- Capture durable project truth in the nearest Pe doc before implementation when the work changes shared language, boundaries, repeated failure modes, architecture rules, or proof-lane rules.

## Proof Lanes

Name the lane before claiming proof:

- **Source compile**: isolated terminal `dotnet build`; NoRrdContact; proves compilation only.
- **Package/artifact**: build/pack output; NoRrdContact; proves durable output shape only.
- **AttachedRrd**: Rider/IDE-built runtime packages synced into the live Rider-driven Revit session; requires live-loop care and behavior/log proof when freshness is uncertain.
- **FreshRevitProcess**: repo test helper owning a fresh Revit process; default autonomous Revit-backed proof when current UI/RRD state is not required.
- **Installed lane**: MSI/product-root behavior; do not mix with dev host/runtime roots.

If proof depends on user-owned Rider/Revit/Windows state, say so and coordinate the loop instead of pretending autonomy.

## Routing

Activate the smallest matching skill from natural language:

- **pe-steer**: vague/strategic scope, terminology, philosophy, durable intent, “grill me”, “think this through”.
- **pe-live-loop**: RRD, Rider, hot reload, active documents, AttachedRrd, visual/manual Revit state, installed-lane coordination.
- **pe-diagnose**: bugs, regressions, confusing errors, failing build/test/script, source-vs-product mismatch.
- **pe-tdd**: tests-first work, regression tests, public-seam behavior changes.
- **pe-architecture**: module seams, product boundaries, desktop vs DA, Pea vs Peco, document-owned vs session-owned.
- **pe-codify-work**: PRDs, RFCs, AFK-ready plans, durable briefs/docs.
- **pe-handoff**: pause/resume/next-agent context.
- **pe-write-skill**: create or revise skills, triggers, slash-skill behavior, skill boundaries.

## Context Resolution

Resolve Pe.Tools truth in this order: nearest `AGENTS.md`, relevant `_GOALS.md`, relevant `_DEV.md`, `docs/features/<feature>/`, generated contracts/schemas/host-operation docs, then source. Do not introduce new context-document conventions unless an explicit design pass replaces the Pe-native taxonomy.

## Live Runtime Defaults

- Use `live_loop_context` as the read-only decision packet when AttachedRrd/Rider/Revit state matters.
- Use `live_rrd_sync` before live scripting or AttachedRrd tests after runtime edits.
- Prefer FreshRevitProcess tests when Hot Reload risk, stale assembly evidence, member-shape changes, or WPF/BAML/resource changes make AttachedRrd ambiguous.
- Use Pea product tools (`pe_status`, `pe_logs`, host operations, scripts, Revit API docs, `talk_to_pea`) only for black-box product feedback, not repo source review.
<!-- Peco managed instructions:end -->
