# pea

## Scope

Owns the deployed Pe Agent command/app surface and the resources exposed to an agent working through `Pe.Host`.

## Purpose

`pea` is the high-trust Revit/operator agent surface for Pe tooling. It should scope the agent's workbench and blast radius while preserving normal filesystem, command, script, diagnostic, and host-operation agency.

## Deployed Agent World

Assume the Pe Agent is running on a user's machine with these resources available:

- a local MSI-installed `pea` command surface available on PATH
- a reachable local `Pe.Host` HTTP server
- a private `Pe.Host` to Revit bridge when Revit is open and connected
- a Pe scripting workspace rooted at a host-reported filesystem path
- Pea-owned MastraCode settings under the host-reported product/workbench root (`.pea/settings.json`)
- generated TypeScript host client methods and operation metadata for public host operations, including compact request/response shape hints
- local workspace files that the agent can read/write before asking Revit to execute a script
- host and Revit logs exposed through typed host operations
- bundled Pea workflow skills for common Revit/operator loops

Do not assume the deployed agent has repo source paths, build outputs, `pe-dev`, Rider/RRD state, package-local DLLs, or developer-only validation commands. Those belong to repo development, not the agent's runtime experience.

## Agent Resources

The Pe-specific resource surface should stay small and load-bearing:

- transient `<pea-startup-context>` - thread-start orientation injected into agent instructions from workspace facts and `revit.context.summary` when available; it is not durable memory and may be stale
- transient `<pea-status-change>` - compact per-thread invalidation notice injected only when cheap host/session status differs from the previous stable signature; unchanged checks stay invisible and previous/current status facts are not injected
- `pe_status` / `pea host status` - explicit source of truth for fresh host, bridge/session, active document, contract, workspace, and log-location facts
- `pe_logs` / `pea host logs` - bounded host/Revit log tails for diagnosis after status or execution indicates a failure
- `script_bootstrap` - create/update the script workspace and return host-owned paths
- `script_execute` - execute either an inline snippet or a workspace-relative C# script through Revit
- `revit_api_search` / `revit_api_fetch` - targeted Revit API documentation lookup
- `host_operation_search` / `pea host operation search` - discover generated public host operations by intent/domain/capability; results include layer/domain noun, cost tier, result grain, request/response hints, and bridge/document/single-flight preflight guidance
- `host_operation_call` / `pea host operation call` - invoke generated public host operations with JSON requests and deterministic next-step guidance on failure; `revit.context.summary` is the source of truth for current user/Revit context, `revit.context.visible-summary` expands active-view visible contents, `revit.catalog.project-browser` answers browser-organized navigation/provenance questions, and deeper catalog/matrix/detail calls should stay bounded
- `pea config defaults` - inspect the Pea-owned settings path, model pack, OM thresholds, goal judge, and quiet/TUI defaults; use `--write` to seed/update the settings file explicitly
- local workspace file/search/edit/command access - use normal agent tools directly instead of custom Pe wrappers

Prefer adding public host operations and generated metadata when the agent needs a new Revit capability. Avoid broad raw HTTP access, giant schema/tool dumps, private bridge frames, or repo-local dev commands as substitutes for intentional public operations.

## Critical Entry Points

- `app/main.ts` - `pea` command tree and human CLI output.
- `app/agent.ts` - tiny `pea agent` entrypoint that runs the Pea runtime through `MastraTUI`.
- `app/pea-runtime.ts` - Pea-owned composition boundary around `createMastraCode`; owns product policy while MastraCode owns runtime primitives.
- `app/pea-agent.ts` - Pea `Agent` construction, dynamic instructions, tools, workspace/model resolution, and processors.
- `app/pea-context-seed.ts` - transient per-thread context provider for startup orientation plus cheap host/session status-change detection.
- `app/pea-processors.ts` - Pea-owned public Mastra processor extensions such as OpenAI Responses item-reference compatibility.
- `app/pea-runtime-policy.ts` - behavior-bearing runtime policy for config dir, MCP default, prompt-caching invariant, and OpenAI Responses compatibility.
- `app/pea-instructions.ts` - Pea-specific agent identity and operational loop.
- `app/tools.ts` - Pe-specific Mastra tools.
- `app/host-operation-runtime.ts` - generated operation search/call runtime.
- `app/pea-runtime-defaults.ts` - Pea-owned MastraCode settings path/default model/runtime seeding.
- `app/bundled-skills.ts` - packaged workflow skill writer copied into `.pea/skills` before agent startup.
- `app/bundled-skill-content/pea-workflow-skills.ts` - bundled workflow skill content.
- `app/generated/host-client.generated.ts` - generated typed host client.
- `app/generated/host-operations.generated.ts` - generated agent-facing host-operation catalog.
- `_GOALS.md` - durable intent for the public Pe Agent surface.
- `_DEV.md` - conceptual architecture for the Pea workbench.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **pea** | Pe Agent; the public agent-owned command/app surface | Prefer this over treating it as a generic umbrella CLI |
| **workbench** | The scoped files, commands, tools, skills, and host operations available to the agent | Prefer this over restrictive wrappers or mode sprawl |
| **agent resource** | A typed capability the deployed agent can actually use | Avoid documenting repo-only tools as if they are deployed resources |
| **host fact** | Runtime, filesystem, install, workspace, or session fact reported by `Pe.Host` | Avoid hardcoded TypeScript guesses for paths or runtime state |
| **startup context** | A transient per-thread orientation block assembled at agent startup from workspace facts and compact Revit context operations when available | Treat it as orientation, not a source of exact current state |
| **status-change context** | A transient per-thread invalidation notice emitted only when normalized cheap host/session status changes between turns | Keep it generic; do not inject previous/current status facts or store it as durable memory |
| **workspace path** | A host-created Pe scripting workspace root | Prefer host bootstrap/status over local path assumptions |
| **generated client** | The TypeScript client emitted from shared host operation contracts | Prefer this over handwritten fetch wrappers |
| **host-operation catalog** | Generated agent-facing operation metadata from C# contracts, including layer/domain/cost/result-grain and request/response shape summaries | Prefer discovery through this over hand-maintained endpoint lists |
| **Revit operation ladder** | `revit.context` -> `revit.catalog`/`revit.resolve` -> bounded `revit.matrix` -> targeted `revit.detail`; `revit.apply` is reserved for mutations | Prefer compact progressive calls over long mandatory chains or broad dumps |
| **sheet anchor map** | Deterministic Revit-native sheet contents such as placed views/schedules, title blocks, sheet-owned text, handles, and bounds | Use as the correlation layer for scripts/extractors/vision; avoid treating it as OCR or full visual understanding |
| **Pea settings** | The MastraCode-compatible settings file owned by this workbench at `.pea/settings.json` under the host-reported product root | Avoid relying on generic/global MastraCode settings for Pea defaults |
| **skill** | An executable workflow recipe loaded by the agent runtime | Avoid using skills as passive docs or as hidden tools |

## Living Memory

- Keep `pea` oriented around agent workflows, generated host contracts, and validation-driven Revit work.
- Pea is a thin product-policy wrapper over MastraCode: keep using `createMastraCode` and `MastraTUI` for storage, memory, MCP lifecycle, hook lifecycle, auth storage, thread handling, workspace setup, and TUI rendering.
- Pea owns instructions, tools, bundled skills, settings defaults, runtime diagnostics, and public-API processors; do not deep-import MastraCode internals for those seams.
- Prompt caching is a Pea invariant and should remain allowed. The OpenAI Responses compatibility path strips brittle provider item-reference replay metadata instead of broadly disabling caching.
- Pea seeds its own settings with the `custom:Pea OpenAI` pack from `app/pea-instructions.ts` and `app/pea-runtime-defaults.ts`; keep docs tied to those constants rather than duplicating model IDs when defaults are in flight.
- Automatic per-turn status checks are an invalidation mechanism, not a hidden status API. Inject only compact `<pea-status-change>` notices; do not inject previous/current status facts or store them in durable memory. Use `pe_status` / `pea host status --json` for explicit host/session refresh or debugging, and `host_operation_call key=revit.context.summary` when exact current Revit view/selection/browser context is required.
- Use `host_operation_search` before writing raw scripts when a host operation may already cover the capability; copy generated request examples and `requestHint` values before falling back to `requestShape`, and avoid guessed wrapper JSON.
- Start with compact context/catalog/resolve operations. Use this decision tree: exact host/session freshness -> `pe_status`; current Revit context -> `revit.context.summary`; visible active-view contents -> `revit.context.visible-summary`; broad semantic inventory -> `revit.catalog.project-index`; browser/navigation/provenance -> `revit.catalog.project-browser`; sheet/native printed anchors -> `revit.detail.sheets`; fuzzy reference -> `revit.resolve.references`; noun inventory -> `revit.catalog.*`; known thing rows/details -> `revit.detail.*`; coverage/join/audit/comparison -> `revit.matrix.*`; mutation/custom API gap -> C# script.
- Use `revit.catalog.project-browser` when user language is browser/navigation-shaped (`printed`, `design`, `reference`, `archive`, `x sheets`, `???`, folder names); use `revit.detail.sheets` when user language is sheet-as-deliverable shaped (`on this sheet`, `placed schedule`, `title block`, `sheet notes`, `export/parse this sheet`). Use semantic catalog/matrix/detail operations for BIM facts. Escalate only with explicit filters, `budget`, and projection/view choices; malformed filters should fail or diagnose, not silently broaden.
- Treat sheet/detail outputs as native anchor maps for C# scripts and external extractors such as PDF/layout parsers or model vision. Do not move OCR, spellcheck engines, or broad visual QA into host-core unless the check needs deterministic Revit handles/provenance.
- Use `host_operation_call` for broad public host reach; add endpoint-specific tools only after repeated real use proves the wrapper earns its context.
- Do not run bridge-backed `singleFlightGroup=revit` operations in parallel. The bridge is the bottleneck, not Pea's tool scheduler.
- For C# scripts, prefer blessed `PeHostClient.Revit.Context/Catalog/Matrix/Detail/Resolve` methods when they cover the task; use generic host operations only for less-common public contracts.
- Use `pea host logs` / `pe_logs` only as a bounded follow-up after status, operation calls, or script execution point at a host/Revit failure.
- The scripting workspace is the agent's primary working directory; scripts should be authored there and executed through `script_execute` / `scripting.execute`.
- Trust the agent with normal file/search/edit/command tools inside its scoped workspace. Do not replace ordinary file work with Pe-specific wrappers.
- Do not let `pea` grow into a second `pe-dev`; repo-local validation, runtime sync, builds, and operator flows stay outside the deployed agent model unless deliberately promoted as public host operations.
- The MSI installs `pea`, not `pe-dev`; keep installer/package changes aligned with that product boundary.
- Local path conventions are critical but should come from `Pe.Host` or shared contracts, not hardcoded TypeScript defaults.
- Packaged Pea skills should read as executable loops with triggers, tools, validation, recovery, and output shape.
