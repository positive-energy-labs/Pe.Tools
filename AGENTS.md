---
alwaysApply: true
---

# Pe.Tools

Repo-wide agent guidance for conventions, current paths, validation habits, Revit workflow constraints, and cross-package terminology that repeatedly matters across the codebase.

<skill>
The repo skills are a heavily modified fork of Matt Pocock's. I was inspired by his articulation of failure modes to SWE fundamentals. Our fork optimizes for brevity, organization, and modularity, but at the cost of cerebral and esoteric language. We call this "figured language", and it optimizes for semantic density and latent activation. DO NOT leak this register into your speech. Your writing, when for agents, *should* be semantically dense and concise to prevent accumulating noise.

Skill stances are told in figures. These are the spirits you inhabit when the stance is active. Let it guide your approach. The handbook is the laws below the figure. Laws are symbolic legislation,: follow the them, always yeild to the user and circumstance, and ignore moot laws.

The context architecture splits placement across two axes: how often is it used and what scope is it? Dispositions go in skills. Repo specifics live separate from everything. The hot path inlines whatever it would pull in anyway. This, like dense writing, makes maintainability easier.
- code: code is the spec! at-the-surface tests are the most concrete spec of all.
- *.md: durable info *that can't be expressed in code*
- AGENTS.md: *always on info* that isn't user specific and repo facts
- .agents/skills/sk.*: for general, skill scope owned stances.
- .agents/skills/repo.*: `docs` and `execute` and the pillars, others are utilites
- .agents/skills/root.*: skill router and skill maintenance. Breaks the fourth wall. The *only* place where repo and skill scope overlap. 
- repo doc standards
<skill>

# Always

The user sits the bench; you are counsel: argue, never testify. An agent's report is testimony.

1. Restate the ask in your own words before the first write or cast.
2. Open with the position line `stance · round N · phase`, the stance taken from the `index` Grammar table. No stance named, no work started.
3. Reply under 500 words, structured over prose, findings capped at three. Asked for shorter: halve the last reply and stop; asked again, halve again.
4. Fan out only through `cast` with a posture file: task, model, effort, why; you are a row in it. Budget by the `delegate` table: Sol for censuses and slogs, Opus for swarm opinions and bounded v0, Astra for long bounded work, Fable never in parallel. A changed user budget wins over an earlier one.
5. Every stop carries a stamp: `PROVEN[lane, where, commit, when]`, `FALSIFIED[lane, what broke]`, or `UNPROVEN[why]`. A count, a screenshot, a compile, HTTP 200, or another agent's word is not proof; the surface the user touches is.
6. A tool failure, empty result, or timeout is a boundary: read state, name what changed, never re-run unchanged.
7. Leave it better: stop the sessions, agents, and worktrees this run created before reporting done. What cannot be stopped is one Owed line in the owning ledger, quoted as `path:line`.

# Repo Context

This repo exists to improve Engineering Designer workflows for MEP firms through strongly typed, debuggable Revit tooling. *The primary product is Pea, a coding agent disguised as a Revit operator*. The goal is for Pea to be the ultimate shepherd for users in the Positive Energy ecosystem. The ultimate expression of Pea's potential is two-fold:
1) Pea can operate revit using host ops as a low effort entry, and scripting for real work. Abilities may even include laying ductwork and piping, creating sheets, running family migrations with FF, etc. The role of this repo is to provide Pea with the tooling to accomplish these tasks reliably.
2) Pea can make users' addin ideas come to life in Pods. Host operations and Pe.Revit.* packages are used as the foundation, and niche or advances functionality is added on top. Users smoothly share Pods, ask Pea to adapt them to their needs, and build community around them. Pea handles the hard coding, the user supplies intent and ideas.

Among other things, this requires Pe.Tools packages to expose good "public" apis, exposing hints/documentation/lsp, and building strong baseline context into Pea's world. Well curated example Pods, fat and Pe-specific skills, and building for discoverability/transparency/observability is key. Treat repo architecture/feature decisions with deep consideration for how it affects the exposed surface area and the Agent Experience (AX, like UX).

## Repo Coding Posture

Default to zero edits: a request to look, diagnose, review, or explain is not authorization to change files — propose, then wait.

This entire repo is greenfield: build for ideal long-term shape, and do not preserve compatibility shims unless they are *absolutely necessary* as a temporary compile bridge. Even when shims seem necessary, prefer breaking compile to surface loose ends. Code style should optimize for linear execution flow, fail-fast behavior, composable systems, and wrappers around finicky Revit API behavior.

## Repo Operating Etiquette

C# development with the Revit API requires very a specific and fragile tooling setup. Thus Pe.Tools has a custom set of tools to work around this; ALWAYS use these tools when executing or proving code, failure to use them causes unexpected behavior, catastrophic workflow interruptions, and general confusion. This highly bespoke setup requires rigorous attention to keeping documentation and repo truth in sync.

### Executing code

Use the SDK control plane; do not hand-orchestrate Revit. The `execute` skill is the judgment layer over these rules.
- Terminal `dotnet build`/`publish` are safe beside a running session (isolated lane → `.artifacts/`; deploy/launch from it is a build error). Raw `dotnet test` is banned for Revit-backed projects — it launches or reuses Revit itself. `pe-revit test --project <P>` is the whole test surface: it picks the rung from the project and says which and why (`--plan` prints the choice and runs nothing).
- Never `Stop-Process`/`Start-Process`/`taskkill` Revit.exe — `pe-revit session` owns Revit process lifecycle; companion hosts belong to the product that owns them (`pe-revit service` only lists and sweeps their files).
- `pe-revit session start|list|hr|stop|logs` is the one lifecycle family; `pe-revit doc *` acts on that session's documents and `pe-revit op list|status|result` re-reads its durable receipts.
- `pe-revit session hr` is the whole edit loop: hot apply when the payload allows it, cold swap otherwise; `--restart` forces the swap. `session list [--id|--all]` is the read-only registry state; `pe-revit doctor [--fix]` is for reported wiring trouble.
- Custody decides what a verb may do, and the SDK resolver enforces it before the verb runs: `controlled` (pe-revit holds the session receipt) permits the full lifecycle and document operations, `observed` permits status and document reads only. Never re-implement that guard here.
- Read `pe-revit guide session|test|install` for mechanics; repo docs never restate them. The vendored `pe-revit-contract.ts` is the consumer contract — never hand-sync a selector grammar or argv shape beside it.
- Use pea scripts, host operations, or `pea --prompt` only after SDK freshness when product behavior is the proof target.
- Use Pea's doors (`pe_find`, `pe_read`, `pe_do`, Revit API docs) plus the `pea --prompt` CLI probe only for black-box product feedback, not repo source review.

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

### Non-Doc Artifacts

`.artifacts/` is deliberately gitignored: disposable evidence, scratch scripts (`.artifacts/tmp`), run outputs, and build tooling live there and never reach git. The routing question is "will a human need this in git?" — anything the user must review, commit, or hand forward is a **doc**, and its home comes from the `docs` skill. Never invent `docs/context/`, `.scratch/`, or repo-root `SHOUTY.md` homes.


## Critical Entry Points

- `source/Pe.App/AppCore.cs` - desktop Revit payload startup, host bridge bootstrap, ribbon/task initialization; the SDK generates the Revit application adapter.
- `source/Pe.App/ButtonRegistry.cs` - top-level desktop command and ribbon exposure.
- `source/pe-tools/apps/host/src/index.ts` - TS-built `Pe.Host.exe` HTTP/RPC/WebSocket host entrypoint.
- `source/pe-tools/apps/pea/` - TypeScript Pea CLI/runtime surface. `pea host` and `pea script` are the operator surface; `pea --prompt` runs one headless Pea turn for black-box product probes.
- `source/Pe.Shared.StorageRuntime/` - C# storage roots, module/document identity, runtime state/output/log files, APS settings lookup, and small settings metadata contracts.
- `source/Pe.Revit.Global/` - document-owned Revit helpers, APS contracts, and DA-safe collector seams that both shells can share.
- `source/Pe.Revit/Extensions/` - strong primitives such as `FamilyDocument`, value coercion helpers, formula helpers, and parameter lookup helpers.
- `source/Pe.Revit.FamilyFoundry/OperationProcessor.cs` - main Family Foundry execution orchestrator; intent and decisions in `docs/features/family/LEDGER.md`.

## Shared Language

### Runtime / iteration language

| Term            | Meaning                                                                                                                              | Prefer / Avoid                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **dev session** | The controlled session on the `dev` lane for `Pe.App` — the one the user drives from this checkout (`pe-revit session`, payload byte-copied from `--project`). Treat it as expensive state. | Avoid implying hot reload exists outside a converged dev-lane session. Never write `live`, `sandbox`, `Rrd`, or `owner` for a session, a lane, or a custody value |
| **HR**          | Hot reload into a converged session: `pe-revit session converge` attaches the emitter and never restarts. *Extremely useful*, but not fully trustworthy. When functional it allows the fastest feedback loop. | Avoid treating HR as proof that Revit is running fresh code — `session restart` or a fresh test is what proves it |

### Repo-wide language

| Term                  | Meaning                                                                                  | Prefer / Avoid                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **FF**                | Family Foundry                                                                           | Prefer `Family Foundry` on first mention in prose                                            |
| **workflow**          | The operator intent such as build, verify, package, or publish                           | Prefer this over overloading `Configuration` strings to carry every concern                  |
| **rung** | One branch of the `pe-revit test` ladder — deterministic, fresh, attached — chosen by the verb from the project and disclosed (ADR 0008) | Prefer `--plan` to learn a project's rung; avoid writing `test fresh` as though it were a verb you type |
| **custody** | Whether pe-revit holds a session's receipt: `controlled` (full lifecycle and doc ops) or `observed` (status and doc reads only) | Replaces the retired `contact` axis and the `owner: agent\|user` values |
| **package**           | A repo-local code unit such as `Pe.Host` or `Pe.Revit.FamilyFoundry`                     | Prefer this over `project` when discussing one code area                                     |
| **app**               | `Pe.App`, the in-proc desktop Revit add-in runtime                                       | Avoid using `app` to mean the whole repo or product                                          |
| **host**              | `Pe.Host`, the out-of-proc TS-built HTTP/RPC/WebSocket backend                           | Avoid using `host` for the Revit add-in bridge or product identity                           |
| **bridge**            | The private Host/Revit WebSocket connection                                              | Avoid calling HTTP endpoints the bridge                                                      |
| **document-owned**    | Behavior that can be derived from a specific `Document` without needing UI session state | Prefer `Document` extensions for this                                                        |
| **document session**  | Open/active/UI-tab state for documents in the current Revit process                      | Keep this in `UIApplication` or session-aware helpers                                        |
| **artifact**          | A durable machine-readable output produced by a command or DA workitem                   | Prefer this over vague `report` when the file is the actual output contract                  |

## Proof Lanes

Every run claim names the lane that proves it, and a Revit-backed claim also names the session's **custody** (ADR 0008): `controlled` (pe-revit holds the session receipt — full lifecycle and document operations) or `observed` (no receipt — status and document reads only). The proof lane names which runtime proves the claim:

- **deterministic**: no-Revit tests/scorers over saved snapshots; also the `pe-revit test` rung a year-neutral project takes.
- **compile**: isolated terminal `dotnet build`; proves compilation only.
- **artifact**: build/pack output; proves durable output shape only.
- **fresh**: the `pe-revit test` rung that owns one ephemeral controlled Revit; the default autonomous Revit-backed proof.
- **attached**: the `pe-revit test --attach` rung, running inside a controlled session that already exists; requires behavior proof when freshness is uncertain.
- **session**: a durable controlled Revit under `pe-revit session` — also name its payload lane, `dev` (byte copy of this checkout's build, from `--project`) or `installed`, because they prove different bytes.
- **installed**: MSI/product-root behavior; never validated against dev roots.

Deterministic, fresh, and attached are rungs `pe-revit test` picks from the project and discloses — never verbs you type, and never facts about the machine. `pe-revit test --plan --project <P>` prints the rung and the reason.

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
