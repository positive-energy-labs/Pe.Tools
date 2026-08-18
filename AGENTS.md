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

Default to zero edits: a request to look, diagnose, review, or explain is not authorization to change files — propose, then wait.

This entire repo is greenfield: build for ideal long-term shape, and do not preserve compatibility shims unless they are *absolutely necessary* as a temporary compile bridge. Even when shims seem necessary, prefer breaking compile to surface loose ends. Code style should optimize for linear execution flow, fail-fast behavior, composable systems, and wrappers around finicky Revit API behavior.

## Repo Operating Etiquette

C# development with the Revit API requires very a specific and fragile tooling setup. Thus Pe.Tools has a custom set of tools to work around this; ALWAYS use these tools when live looping, failure to use them causes unexpected behavior, catasrophic workflow interuptions, and general confusion. This highly bespoke setup requires rigorous attention to keeping documentation and repo truth in sync.

### Live Looping

Use the SDK control plane; do not hand-orchestrate Revit.
- Terminal `dotnet build`/`publish` are safe beside a live session (isolated lane → `.artifacts/`; deploy/launch from it is a build error). Raw `dotnet test` is not — it launches or reuses Revit itself; use `pe-revit test fresh|attached`.
- Never `Stop-Process`/`Start-Process`/`taskkill` Revit.exe — `pe-revit live|sandbox|sessions|service` own process lifecycle.
- Use `pe-revit live` to compile-check, Hot Reload, start, or restart the dev session.
- Use `pe-revit live status` for read-only state; use `live doctor` only for reported wiring trouble.
- Use `pe-revit test fresh|attached` for Revit-backed proof lanes.
- Use pea scripts, host operations, or `pea --prompt` only after SDK freshness when product behavior is the proof target.
- Prefer FreshRevitProcess tests when Hot Reload risk, stale assembly evidence, member-shape changes, or WPF/BAML/resource changes make AttachedRrd ambiguous.
- Use Pea product tools (`pe_status`, `pe_logs`, host operations, scripts, Revit API docs) plus the `pea --prompt` CLI probe only for black-box product feedback, not repo source review.

### Session Discipline

- Assume you will be interrupted. Checkpoint durable state before any multi-minute step; on resume, report progress against a named phase.
- A user interrupt kills every in-flight subagent — after any interruption, check-then-relaunch; never assert a subagent is alive.
- Delegation shape is user-governed: declare your assumed budget posture (see the `delegate` skill); no review/standards subagents unless asked.

### Documentation

`AGENTS.md`: Primary knowledge map; should stay high-level and focused on constraints, justifications for decisions, broad intent, current direction, and broad direction.
ANY change to repo architecture, tooling, or builds MUST consult these documents:
- `docs/ARCHITECTURE.md` - read before multi module changes, debugging, and code review. Contains target architecture; code should always seek to align and documentation can be future facing.
- `docs/BUILD.md` - read before changing anything build, deploy, or dev-loop related. Contians repo tooling justification and explanation. Always prove (or disprove) before changing the document. Information and correctness here is mission critical. TL;DR:
  - Keep terminal compile/package proof separate from live-runtime freshness.
  - Protect the current dev session aggressively. Breaking it can turn a small edit into a multi-minute restart plus document reopen wait.


After any large changes, ALWAYS clarify user intent and capture the durable knowledge. Where it goes is governed by the `docs` skill (the single source of truth): feature ledgers (`docs/features/<name>/LEDGER.md`), ADRs, scoped grounding docs, or code comments. AGENTS.md holds operating rules only — not feature goals, not session knowledge.

### Tooling Footguns

- A skill whose `description:` frontmatter value contains `: "` is parsed by gray-matter as an invalid YAML mapping, and
  the skill is dropped silently — no warning, it simply never loads. Keep `: "` out of skill descriptions.
- `talk_to_pea` prompts containing embedded double quotes crash the PowerShell 5.1 arg path (exit 255). Reword or use a
  here-string path instead.
- **Windows shell tax** (top friction source in 2 months of session history — mined 2026-08-18):
  the shell is PowerShell, not bash. rg alternation/quotes/globs need PS-safe forms (`unclosed group`,
  `os error 123` = your quoting, not the tool); `$PID`/`$Host` are readonly built-ins; `2>&1` on a
  native exe fabricates NativeCommandError from advisory stderr — a "failure" wrapping a success;
  rg exit 1 means "no matches", not an error. Never blind-retry a quoting variant, and never put
  JSON on a command line (`pea ... --request '{...}'` dies in re-quoting): one failed quote → write
  the payload/pattern to a file (harness Read/Grep tools where available) — see the `live-loop` skill.
- Client timeout ≠ server cancel: a killed pe-revit/dotnet call keeps running and blocks the next
  one. Background + poll for anything minutes-scale; `status` read before any retry.

### Non-Doc Artifacts

`.artifacts/` is deliberately gitignored: disposable evidence, scratch scripts (`.artifacts/tmp`), run outputs, and build tooling live there and never reach git. The routing question is "will a human need this in git?" — anything the user must review, commit, or hand forward is a **doc**, and its home comes from the `docs` skill. Never invent `docs/context/`, `.scratch/`, or repo-root `SHOUTY.md` homes.


## Critical Entry Points

- `source/Pe.App/AppCore.cs` - desktop Revit payload startup, host bridge bootstrap, ribbon/task initialization; the SDK generates the Revit application adapter.
- `source/Pe.App/ButtonRegistry.cs` - top-level desktop command and ribbon exposure.
- `source/pe-tools/apps/host/src/index.ts` - TS-built `Pe.Host.exe` HTTP/RPC/WebSocket host entrypoint.
- `source/pe-tools/apps/pea/` - TypeScript Pea CLI/runtime surface. `pea agent` is the deployed Revit/operator workbench; `pea --prompt` runs one headless Pea turn for black-box product probes.
- `source/Pe.Shared.StorageRuntime/` - C# storage roots, module/document identity, runtime state/output/log files, APS settings lookup, and small settings metadata contracts.
- `source/Pe.Revit.Global/` - document-owned Revit helpers, APS contracts, and DA-safe collector seams that both shells can share.
- `source/Pe.Revit/Extensions/` - strong primitives such as `FamilyDocument`, value coercion helpers, formula helpers, and parameter lookup helpers.
- `source/Pe.Revit.FamilyFoundry/OperationProcessor.cs` - main Family Foundry execution orchestrator; intent and decisions in `docs/features/family/LEDGER.md`.

## Shared Language

### Runtime / iteration language

| Term            | Meaning                                                                                                                              | Prefer / Avoid                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **dev session** | The live hot-reload Revit session for `Pe.App` (lane `dev`, driven by `pe-revit live`; formerly "RRD"). Treat it as expensive state. | Avoid implying hot reload exists outside the dev session (`RRD` remains a common alias in chat)           |
| **HR**          | SDK hot reload into the already-running dev session. Useful, but not fully trustworthy.                                              | Avoid treating HR as proof that Revit is running fresh code                                             |

### Repo-wide language

| Term                  | Meaning                                                                                  | Prefer / Avoid                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **FF**                | Family Foundry                                                                           | Prefer `Family Foundry` on first mention in prose                                            |
| **workflow**          | The operator intent such as build, verify, package, or publish                           | Prefer this over overloading `Configuration` strings to carry every concern                  |
| **execution policy**  | Whether a workflow is allowed to touch the dev session                                   | Prefer the literal policy tokens `NoRrdContact` / `RrdRequired` over vague safety assumptions |
| **AttachedRrd**       | Verification against the already-running desktop dev session (literal MSBuild token — keeps the legacy name) | Prefer this over vague `live tests` phrasing when the running session itself matters         |
| **FreshRevitProcess** | Verification in a new dedicated Revit process that must not reuse the dev session        | Prefer this over vague `isolated tests` phrasing when freshness and process ownership matter |
| **package**           | A repo-local code unit such as `Pe.Host` or `Pe.Revit.FamilyFoundry`                     | Prefer this over `project` when discussing one code area                                     |
| **app**               | `Pe.App`, the in-proc desktop Revit add-in runtime                                       | Avoid using `app` to mean the whole repo or product                                          |
| **host**              | `Pe.Host`, the out-of-proc TS-built HTTP/RPC/WebSocket backend                           | Avoid using `host` for the Revit add-in bridge or product identity                           |
| **bridge**            | The private Host/Revit WebSocket connection                                              | Avoid calling HTTP endpoints the bridge                                                      |
| **document-owned**    | Behavior that can be derived from a specific `Document` without needing UI session state | Prefer `Document` extensions for this                                                        |
| **document session**  | Open/active/UI-tab state for documents in the current Revit process                      | Keep this in `UIApplication` or session-aware helpers                                        |
| **artifact**          | A durable machine-readable output produced by a command or DA workitem                   | Prefer this over vague `report` when the file is the actual output contract                  |

## Proof Lanes

Name the lane before claiming proof:

- **Source compile**: isolated terminal `dotnet build`; NoRrdContact; proves compilation only.
- **Package/artifact**: build/pack output; NoRrdContact; proves durable output shape only.
- **AttachedRrd**: SDK-converged runtime packages in the live dev session; requires behavior proof when freshness is uncertain.
- **FreshRevitProcess**: SDK `pe-revit test fresh` owns a fresh Revit process; default autonomous Revit-backed proof when current UI/dev-session state is not required.
- **Installed lane**: MSI/product-root behavior; do not mix with dev host/runtime roots.

If proof depends on user-owned Revit/Windows state, say so and coordinate the loop instead of pretending autonomy.

## Routing

The `index` skill is the entry point and router for the whole skill set — invoke it with intent and it picks the route and drives the loop. The `docs` skill governs where durable knowledge lands. Don't guess at routes; read those two.



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
