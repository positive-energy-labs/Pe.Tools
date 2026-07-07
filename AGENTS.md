---
alwaysApply: true
---

# Pe.Tools

Repo-wide agent guidance for conventions, current paths, validation habits, Revit workflow constraints, and cross-package terminology that repeatedly matters across the codebase.

# Repo Context

This repo exists to improve Engineering Designer workflows for MEP firms through strongly typed, debuggable Revit tooling. *The primary product is Pea, a coding agent disguised as a Revit operator*. The goal is for Pea to be the ultimate shepherd for users in the Positive Energy ecosystem. The ultimate expression of Pea's potential is two-fold:
1) Pea can operate revit using host ops as a low effort entry, and scripting for real work. Abilities may even include laying ductwork and piping, creating sheets, running family migrations with FF, etc. The role of this repo is to provide Pea with the tooling to accomplish these tasks reliably.
2) Pea can make users' addin ideas come to life in Pods. Host operations and Pe.Revit.* packages are used as the foundation, and niche or advances functionality is added on top. Users smoothly share Pods, ask Pea to adapt them to their needs, and build community around them. Pea handles the hard coding, the user supplies intent and ideas.

Among other things, this requires Pe.Tools packages to expose good "public" apis, exposing hints/documentation/lsp, and building strong baseline context into Pea's world. Well curated example Pods, fat and Pe-specific skills, and building for discoverability/transparency/observability is key. Treat repo architecture/feature decisions with deep consideration for how it affects the exposed surface area and the Agent Experience (AX, like UX).

## Repo Coding Posture

This entire repo is greenfield: build for ideal long-term shape, and do not preserve compatibility shims unless they are *absolutely necessary* as a temporary compile bridge. Even when shims seem necessary, prefer breaking compile to surface loose ends. Code style should optimize for linear execution flow, fail-fast behavior, composable systems, and wrappers around finicky Revit API behavior.

## Repo Operating Etiquette

C# development with the Revit API requires very a specific and fragile tooling setup. Thus Pe.Tools has a custom set of tools to work around this; ALWAYS use these tools when live looping, failure to use them causes unexpected behavior, catasrophic workflow interuptions, and general confusion. This highly bespoke setup requires rigorous attention to keeping documentation and repo truth in sync.

### Live Looping

ALWAYS use RRD-safe live-loop tools, mcps, or cli commands when available.
- Use `live_loop_context` as the read-only decision packet when AttachedRrd/Rider/Revit state matters.
- Use SDK `pe-revit live` / MCP `live_converge` to sync, hot reload, or start/restart RRD.
- Use SDK `pe-revit test fresh|attached` / MCP `test_fresh` and `test_attached` for Revit-backed proof lanes.
- Use Peco `script_execute` or `talk_to_pea` when the tool should run after an SDK freshness preflight and include Pea-facing evidence.
- Prefer FreshRevitProcess tests when Hot Reload risk, stale assembly evidence, member-shape changes, or WPF/BAML/resource changes make AttachedRrd ambiguous.
- Use Pea product tools (`pe_status`, `pe_logs`, host operations, scripts, Revit API docs, `talk_to_pea`) only for black-box product feedback, not repo source review.

### Documentation

`AGENTS.md`: Primary knowledge map; should stay high-level and focused on constraints, justifications for decisions, broad intent, current direction, and broad direction.
ANY change to repo architecture, tooling, or builds MUST consult these documents:
- `docs/ARCHITECTURE.md` - read before multi module changes, debugging, and code review. Contains target architecture; code should always seek to align and documentation can be future facing.
- `docs/BUILD.md` - read before changing anything build, deploy, or dev-loop related. Contians repo tooling justification and explanation. Always prove (or disprove) before changing the document. Information and correctness here is mission critical. TL;DR:
  - Keep terminal compile/package proof separate from live-runtime freshness.
  - Protect the current RRD session aggressively. Breaking it can turn a small edit into a multi-minute restart plus document reopen wait.


After any large changes, ALWAYS clarify user intent and capture then durable knowledge. Knowledge should be captured to the most granular artifact. For example, FF goals should not exist substantially in the root AGENTS.md. This repo uses `AGENTS.md` as the primary knowledge map, `README.md` as the dev-facing docs/notes, and `GOALS.md` as PRD-like documents capturing intent and direction.

Other durrable knowledge should be captured to `docs/context` for saved knowledge/ideas/etc and `docs/features` for planned/in-progress work. Context can and should be treated lightly, features should get extra attention to continuity of ideas, calrifying ambiguity, and being practical.

### Non-Doc Artifacts

Write artifacts to `.artifacts/`. Most often `.artifacts/tmp` for python/typescript scripts. Repo-wide, builds and other tooling behaviors route through `.artifacts/`, thus it is git ignored. 


## Critical Entry Points

- `source/Pe.App/Application.cs` - desktop Revit add-in startup, host bridge bootstrap, ribbon/task initialization.
- `source/Pe.App/ButtonRegistry.cs` - top-level desktop command and ribbon exposure.
- `source/pe-tools/apps/host/src/index.ts` - TS-built `Pe.Host.exe` HTTP/RPC/WebSocket host entrypoint.
- `source/pea/app/` - TypeScript Pea CLI/runtime surface. `pea agent` is the deployed Revit/operator workbench; `peco` starts Peco, the MastraCode-based repo coding agent with Pea black-box feedback tools.
- `source/Pe.Shared.StorageRuntime/` - C# storage roots, module/document identity, runtime state/output/log files, APS settings lookup, and small settings metadata contracts.
- `source/Pe.Revit.Global/` - document-owned Revit helpers, APS contracts, and DA-safe collector seams that both shells can share.
- `source/Pe.Revit/Extensions/` - strong primitives such as `FamilyDocument`, value coercion helpers, formula helpers, and parameter lookup helpers.
- `source/Pe.Revit.FamilyFoundry/OperationProcessor.cs` - main Family Foundry execution orchestrator.
- `docs/features/family-foundry/_README.md` and `_GOALS.md` - Family Foundry architecture and intent.

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
| **host**              | `Pe.Host`, the out-of-proc TS-built HTTP/RPC/WebSocket backend                           | Avoid using `host` for the Revit add-in bridge or product identity                           |
| **bridge**            | The private Host/Revit WebSocket connection                                              | Avoid calling HTTP endpoints the bridge                                                      |
| **automation shell**  | The headless DA runtime rooted in `Pe.Dev.RevitAutomation.Worker`                        | Prefer this over implying `Pe.App` itself runs in DA                                         |
| **document-owned**    | Behavior that can be derived from a specific `Document` without needing UI session state | Prefer `Document` extensions for this                                                        |
| **document session**  | Open/active/UI-tab state for documents in the current Revit process                      | Keep this in `UIApplication` or session-aware helpers                                        |
| **artifact**          | A durable machine-readable output produced by a command or DA workitem                   | Prefer this over vague `report` when the file is the actual output contract                  |
| **workitem**          | One APS Design Automation job submission                                                 | Prefer one workitem per cloud model for batch collection                                     |

## Proof Lanes

Name the lane before claiming proof:

- **Source compile**: isolated terminal `dotnet build`; NoRrdContact; proves compilation only.
- **Package/artifact**: build/pack output; NoRrdContact; proves durable output shape only.
- **AttachedRrd**: Rider/IDE-built runtime packages synced into the live Rider-driven Revit session; requires live-loop care and behavior/log proof when freshness is uncertain.
- **FreshRevitProcess**: SDK `pe-revit test fresh` owns a fresh Revit process; default autonomous Revit-backed proof when current UI/RRD state is not required.
- **Installed lane**: MSI/product-root behavior; do not mix with dev host/runtime roots.

If proof depends on user-owned Rider/Revit/Windows state, say so and coordinate the loop instead of pretending autonomy.

## Routing

Activate the smallest matching skill from natural language:

- **pe-steer**: vague/strategic scope, terminology, philosophy, durable intent, “grill me”, “think this through”.
- **pe-live-loop**: RRD, Rider, hot reload, active documents, AttachedRrd, visual/manual Revit state, installed-lane coordination.
- **pe-diagnose**: bugs, regressions, confusing errors, failing build/test/script, source-vs-product mismatch.
- **pe-tests**: tests-first work, regression tests, public-seam behavior changes.
- **pe-architecture**: module seams, product boundaries, desktop vs DA, Pea vs Peco, document-owned vs session-owned.
- **pe-codify-work**: PRDs, RFCs, AFK-ready plans, durable briefs/docs.
- **pe-handoff**: pause/resume/next-agent context.
- **pe-write-skill**: create or revise skills, triggers, slash-skill behavior, skill boundaries.



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
