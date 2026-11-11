---
alwaysApply: true
---

# Pe.Tools

Repo-wide agent guidance for conventions, current paths, validation habits, Revit workflow constraints, and cross-package terminology that repeatedly matters across the codebase.

# Always

You are the main agent: you argue for a recommendation and you answer for it. The user rules.

1. **Two accounts before building.** Restate the ask in your own words, then say what the repo shows. Lead with where they differ.
2. **Anchor every place you name** with a link that focuses it, an id the user can search, or a picture with it marked. A size, a coordinate, or a callout number from an earlier message is not an anchor.
3. **Stamp every stop** as PROVEN, FALSIFIED, or UNPROVEN, in the format the `prove` skill defines. A count, a screenshot, a compile, HTTP 200, or another agent's report is testimony until you check it.
4. **A tool failure, empty result, or timeout is a boundary.** Read state and name what changed. Never re-run it unchanged.
5. **Delegate most substantive work by default,** to the cheapest model that can do the task. Keep the main agent available for discussion and joint inspection. The `execute` skill says which tool runs a subagent.
6. **Keep Revit custody.** Opening a `.rvt` by file association joins whatever Revit is running, including an SDK snapshot session. Never open a document for the user while a controlled session runs, and stop only the session you started.
7. **Leave it better.** Stop the sessions, agents, servers and worktrees this run created before reporting done. What cannot be stopped is one Owed line in the owning ledger.
8. **Commits carry provenance** through the repo's `prepare-commit-msg` hook, which adds the T3 thread trailer. `python .agents/skills/check.py --fix` installs the hook.

## Route by the failure you are about to commit

<!-- routing:start -->
| About to commit | Stance |
|---|---|
| context rot: one session carrying everything, the main agent building | `delegate` |
| templated surfaces: a screen that fits no house | `house` |
| plausible, not real: done on a mock, a count, a screenshot, or another agent's word; or built on assumed soil, a shape settled before the real model was examined | `prove` |
| bloat: adding to a place that already has too much | `purge` |
| the dropped handoff: the next session re-derives what this one knew | `relay` |
| premature release closure: shipped bytes never made the crossing | `release` |
| the repeated cost: a costly session pattern paid again because nobody measured it | `retro` |
| shims for done: a settled surface over a fake backend | `close` |
| the unbounded run: work with no frozen limits, or the same wave sent twice at a plateau | `control` |
| guessed fix: a diff before a cause | `diagnose` |
| decisions made for the user: a plan built on verdicts never given | `grill` |
| first shape kept: a seam settled before the alternatives were seen | `muse` |
| wrong product: canonizing a surface nobody felt | `protoui` |
| the answer handed over: the user owns nothing | `teach` |
| tuned by ear: a constant fixed by hand where a rule should hold | `tune` |
| the summary: a recording remembered as prose nobody can point at | `debrief` |
| lost decisions: verdicts in chat, nowhere else | `docs` |
| the wrong reality: a claim proved on a lane that cannot falsify it | `execute` |
| rumor: a finding without lineage | `mine` |
| the painting: a page with no state behind it | `page` |
| rumor about a rival: a claim about their product nobody traced to their bytes | `recon` |
| the wall of text: a topic explained in prose that a diagram would settle | `show-me` |
<!-- routing:end -->

`python .agents/skills/check.py --fix` projects this table from each skill's `prevents:`. Do not edit it by hand.

# Repo Context

This repo exists to improve Engineering Designer workflows for MEP firms through strongly typed, debuggable Revit tooling. *The primary product is Pea, a coding agent disguised as a Revit operator*. The goal is for Pea to be the ultimate shepherd for users in the Positive Energy ecosystem. The ultimate expression of Pea's potential is two-fold:
1) Pea can operate revit using host ops as a low effort entry, and scripting for real work. Abilities may even include laying ductwork and piping, creating sheets, running family migrations with FF, etc. The role of this repo is to provide Pea with the tooling to accomplish these tasks reliably.
2) Pea can make users' addin ideas come to life in Pods. Host operations and Pe.Revit.* packages are used as the foundation, and niche or advances functionality is added on top. Users smoothly share Pods, ask Pea to adapt them to their needs, and build community around them. Pea handles the hard coding, the user supplies intent and ideas.

Among other things, this requires Pe.Tools packages to expose good "public" apis, exposing hints/documentation/lsp, and building strong baseline context into Pea's world. Well curated example Pods, fat and Pe-specific skills, and building for discoverability/transparency/observability is key. Treat repo architecture/feature decisions with deep consideration for how it affects the exposed surface area and the Agent Experience (AX, like UX).

## Posture

### Product

- Make the relevant world smaller and more trustworthy; do not solve uncertainty by dumping tools, prompt text, or stale context.
- One capability gets one progressively discoverable path. Remove duplicate, unavailable, and admin-only choices from normal discovery.
- Libraries own Revit/domain meaning. Desktop, DA, host, CLI, and UI are thin adapters; keep the Host/Revit bridge private.
- C# DTOs and operation metadata, plus the **generated operation catalog**, are public-contract authority; the live connected host answers availability only.
- Keep document-owned, DA-safe behavior separate from `UIApplication` and session behavior. Desktop and DA are sibling shells.
- Keep one canonical persisted state/event model; derive protocol and UI views from it rather than maintaining competing writable state.
- Use scripts for exploration and awkward mutation; promote stable repeated capabilities into typed public contracts.
- Default to safe, inspectable action. Human and Pea share editable Work and semantic commands. Pea acts without a human: run consent lasts per thread and auto-approves after a "Reject?" window (ADR 0027); users retain edit, undo, Stop and cancellation control. Host evidence remains host-owned.
- Treat Revit metadata, wrapper identity, and positional correspondence as untrusted until real behavior proves them. Treat project models as adversarial input; preserve coordinate frames and stable identities.
- Surface provenance and uncertainty explicitly. Spatial/model claims need inspectable, freshness-aware visual or behavioral evidence; plausible counts are not proof.

### Engineering

- Keep deterministic sequencing, validation, safety, and freshness in the harness; put reusable judgment-heavy workflows in skills and changing maps in generated artifacts.
- Agent-facing work stays bounded, checkpointable, and honest about residual gaps.
- Long time on task or a loop that stops progressing calls for a look at the underlying problem. A subagent's time on task is a strong signal that the architecture is bad, because its context holds none of the implementation history.
- Delete a data-integrity or runtime seam only when the simpler replacement preserves its behavior and proof.
- When departing from a prior decision or philosophy, leave a short comment at the exception naming the rule, why it does not apply here, and the boundary that still holds. Correct nearby comments that now contradict the code; do not make the next agent infer a deliberate exception from a diff.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for product direction, [docs/BUILD.md](docs/BUILD.md) for proof and runbook guidance, and the nearest package `AGENTS.md` before local changes.

### Coding

Default to zero edits: a request to look, diagnose, review, or explain is not authorization to change files. Propose, then wait.

This entire repo is greenfield: build for ideal long-term shape, and do not preserve compatibility shims unless they are *absolutely necessary* as a temporary compile bridge. Even when shims seem necessary, prefer breaking compile to surface loose ends. Code style should optimize for linear execution flow, fail-fast behavior, composable systems, and wrappers around finicky Revit API behavior.

## Repo Operating Etiquette

C# development with the Revit API needs a specific and fragile tooling setup, so Pe.Tools has its own tools for running and proving code. Always use them, because working around them interrupts the user's workflow and confuses every later agent.

### Executing code

The `execute` skill holds the proof lanes and the run mechanics. `pe-revit guide session|test|install` holds the verbs, flags, and exit codes, so repo docs never restate them. Four rules hold everywhere:
- Never run raw `dotnet test` on a Revit-backed project, because it launches or reuses Revit itself. `pe-revit test --project <P>` is the test surface.
- Never start or kill `Revit.exe` with `Start-Process`, `Stop-Process`, or `taskkill`.
- `pe-revit session` owns the Revit process lifecycle.
- The SDK resolver enforces custody (the pe-revit SDK's ADR 0012, not this repo's: a checkout never drives an installed Revit, nor the reverse). Never re-implement that guard here.

### Session Discipline

- Assume you will be interrupted. Checkpoint durable state before any multi-minute step; on resume, report progress against a named phase.
- A user interrupt kills every in-flight subagent, so after any interruption, check-then-relaunch; never assert a subagent is alive.
- Do not run standards-only review subagents. A change to a contract, a data-loss path, or an installed surface gets a non-author review as part of its landing, and the `prove` skill names the tiers.

### Documentation

`AGENTS.md`: Primary knowledge map; should stay high-level and focused on constraints, justifications for decisions, broad intent, current direction, and broad direction.
ANY change to repo architecture, tooling, or builds MUST consult these documents:
- `docs/ARCHITECTURE.md` - read before multi module changes, debugging, and code review. Contains target architecture; code should always seek to align and documentation can be future facing.
- `docs/BUILD.md` - read before changing anything build, deploy, or dev-loop related. Contains repo tooling justification and explanation. Always prove (or disprove) before changing the document. Information and correctness here is mission critical. TL;DR:
  - Keep terminal compile/package proof separate from live-runtime freshness.
  - Protect the current dev session aggressively. Breaking it can turn a small edit into a multi-minute restart plus document reopen wait.


After any large changes, ALWAYS clarify user intent and capture the durable knowledge. Where it goes is governed by the `docs` skill (the single source of truth): feature ledgers (`docs/features/<name>/LEDGER.md`), ADRs, scoped grounding docs, or code comments. AGENTS.md holds operating rules only, not feature goals, not session knowledge.

### Tooling Footguns

- `talk_to_pea` prompts containing embedded double quotes crash the PowerShell 5.1 arg path (exit 255). Reword or use a
  here-string path instead.
- **Windows shell tax**: the shell is PowerShell, not bash. rg alternation/quotes/globs need PS-safe forms (`unclosed group`,
  `os error 123` = your quoting, not the tool); `$PID`/`$Host` are readonly built-ins; `2>&1` on a
  native exe fabricates NativeCommandError from benign stderr, a "failure" wrapping a success;
  rg exit 1 means "no matches", not an error. Never blind-retry a quoting variant, and never put
  JSON on a command line (`pea ... --request '{...}'` dies in re-quoting): one failed quote → write
  the payload/pattern to a file (harness Read/Grep tools where available), see the `execute` skill.
- The harness Bash tool is Git Bash. It rewrites an argument that starts with `/` into a Windows path (`/fans/` becomes `C:/Program Files/Git/fans/`). Set `MSYS_NO_PATHCONV=1` on a command that passes a route or a `/regex/`.
- `pe-revit dev link` run through the shim fails with "file in use", because the shim locks its own `pe-revit.exe` and `Pe.Revit.Cli.dll`. Run `dotnet tool run pe-revit -- dev link` from the checkout instead.
- Background and poll anything minutes-scale, and read `status` before any retry. The SDK reaps its own children.
- A `preview_evaluate` that runs past its 15 s limit kills whatever JavaScript the page is running then; inside a React render that leaves the page wedged with no error. Poll with short evaluates; never wait inside one.
- `git stash` is one stack shared by every worktree of this repo, so a `stash pop` in one worktree applies
  another agent's work. Never stash in a worktree. Commit WIP on your branch instead.

### Non-Doc Artifacts

`.artifacts/` is deliberately gitignored: disposable evidence, scratch scripts (`.artifacts/tmp`), run outputs, and build tooling live there and never reach git. The routing question is "will a human need this in git?", anything the user must review, commit, or hand forward is a **doc**, and its home comes from the `docs` skill. Never invent `docs/context/`, `.scratch/`, or repo-root `SHOUTY.md` homes.


## Critical Entry Points

- `dotnet/Pe.App/AppCore.cs` - desktop Revit payload startup, host bridge bootstrap, ribbon/task initialization; the SDK generates the Revit application adapter.
- `dotnet/Pe.App/ButtonRegistry.cs` - top-level desktop command and ribbon exposure.
- `ts/apps/host/src/index.ts` - TS-built `Pe.Host.exe` HTTP/RPC/WebSocket host entrypoint.
- `ts/apps/pea/` - TypeScript Pea CLI/runtime surface. `pea host` and `pea script` are the operator surface; `pea --prompt` runs one headless Pea turn for black-box product probes.
- `dotnet/Pe.Shared.StorageRuntime/` - C# storage roots, module/document identity, runtime state/output/log files, APS settings lookup, and small settings metadata contracts.
- `dotnet/Pe.Revit.Global/` - document-owned Revit helpers, APS contracts, and DA-safe collector seams that both shells can share.
- `dotnet/Pe.Revit/Extensions/` - strong primitives such as `FamilyDocument`, value coercion helpers, formula helpers, and parameter lookup helpers.
- `dotnet/Pe.Revit.FamilyFoundry/OperationProcessor.cs` - main Family Foundry execution orchestrator; intent and decisions in `docs/features/family/LEDGER.md`.

## Shared Language

### Runtime / iteration language

| Term            | Meaning                                                                                                                              | Prefer / Avoid                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **dev session** | The controlled session on the `dev` lane for `Pe.App`, the one the user drives from this checkout (`pe-revit session`, payload byte-copied from `--project`). Treat it as expensive state. | Avoid implying hot reload exists outside a converged dev-lane session. Never write `live`, `sandbox`, `Rrd`, or `owner` for a session, a lane, or a custody value |
| **HR**          | Hot reload into a dev session: `pe-revit session hr` hot-applies when the payload allows it and cold-swaps otherwise. *Extremely useful*, but not fully trustworthy. When functional it allows the fastest feedback loop. | Avoid treating a hot apply as proof that Revit is running fresh code, `session hr --restart` or a fresh test is what proves it |

### Repo-wide language

| Term                  | Meaning                                                                                  | Prefer / Avoid                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **FF**                | Family Foundry                                                                           | Prefer `Family Foundry` on first mention in prose                                            |
| **workflow**          | The operator intent such as build, verify, package, or publish                           | Prefer this over overloading `Configuration` strings to carry every concern                  |
| **rung** | One branch of the `pe-revit test` ladder, deterministic, fresh, attached, chosen by the verb from the project and disclosed (ADR 0008) | Prefer `--plan` to learn a project's rung; avoid writing `test fresh` as though it were a verb you type |
| **custody** | Whether pe-revit holds a session's receipt: `controlled` (full lifecycle and doc ops) or `observed` (status and doc reads only) | Replaces the retired `contact` axis and the `owner: agent\|user` values |
| **package**           | A repo-local code unit such as `Pe.Host` or `Pe.Revit.FamilyFoundry`                     | Prefer this over `project` when discussing one code area                                     |
| **app**               | `Pe.App`, the in-proc desktop Revit add-in runtime                                       | Avoid using `app` to mean the whole repo or product                                          |
| **host**              | `Pe.Host`, the out-of-proc TS-built HTTP/RPC/WebSocket backend                           | Avoid using `host` for the Revit add-in bridge or product identity                           |
| **bridge**            | The private Host/Revit WebSocket connection                                              | Avoid calling HTTP endpoints the bridge                                                      |
| **document-owned**    | Behavior that can be derived from a specific `Document` without needing UI session state | Prefer `Document` extensions for this                                                        |
| **document session**  | Open/active/UI-tab state for documents in the current Revit process                      | Keep this in `UIApplication` or session-aware helpers                                        |
| **artifact**          | A durable machine-readable output produced by a command or DA workitem                   | Prefer this over vague `report` when the file is the actual output contract                  |
| **inference endpoint** | A user-added provider of one harness: a base URL plus key stored in `providers.json` and passed to the harness child as env (ADR 0014, superseded by ADR 0015). Claude's speaks the Messages API, Codex's the Responses API. Pea sends no model call itself | Prefer "endpoint provider" for the record and "subscription provider" for the harness's own login; avoid naming Tailscale, Codex, or a cloud as a Pea feature |

## Proof Lanes

Every run claim names the lane that proves it, and a Revit-backed claim also names the session's custody (ADR 0008). When proof depends on the user's own Revit or Windows state, say so and run the loop with the user. The `execute` skill lists the lanes and what each one cannot prove.

## Routing

The `index` skill is the entry point and router for the whole skill set: invoke it with intent and it picks the route and drives the loop. The `docs` skill governs where durable knowledge lands. Don't guess at routes; read those two.


### Docs conventions

No external issue tracker. Durable knowledge lives in feature ledgers (`docs/features/<name>/LEDGER.md`), ADRs (`docs/adr/`), authority docs, and disposable handoffs (`.artifacts/handoffs/`). The `docs` skill is the single source of truth, read it before writing any markdown.

### Product surfaces

`docs/design/SURFACE-PHILOSOPHY.md` holds what our UI surfaces are for and how they behave, `house` reads it, and a `protoui` verdict that changes it is captured there per `docs`. The open design decisions, rulings, gaps, and owed work for the design system live at `docs/features/design-system/LEDGER.md`. The web app's design-system route is the executable design authority.

### Domain docs

Glossaries are scoped: package terms in that package's `AGENTS.md` Shared Language table, feature terms in `docs/features/<name>/GLOSSARY.md` (lazy). ADRs in `docs/adr/`. The `grill` skill grows both; formats live beside the `docs` skill.



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
