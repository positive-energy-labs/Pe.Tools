# pea

## Scope

Owns the deployed Pe Agent command/app surface and the resources exposed to an agent working through `Pe.Host`.

## Purpose

`pea` is a Revit/operator workbench for an agent. It should orient the agent to the local Pe architecture, then let typed tools, generated operation metadata, diagnostics, scripts, and artifacts guide the actual work.

## Deployed Agent World

Assume the deployed agent may have:

- a local MSI-installed `pea` command on PATH
- a reachable local `Pe.Host` HTTP server
- an optional private `Pe.Host` to Revit bridge when Revit is open and connected
- a host-created scripting workspace
- generated host-operation metadata and a small generated TypeScript client slice
- normal local file/search/edit/command tools inside the scoped workspace
- bounded host/Revit logs
- optional bundled workflow skills

Do not assume repo source paths, build outputs, `pe-dev`, Rider/RRD state, package-local DLLs, or developer-only validation commands unless the user is explicitly doing repo development.

## Operating Model

Keep the system prompt small. It should tell the agent what world it is in, what resources exist, and what boundaries matter. It should not encode task-specific ladders that the host-operation catalog, tool schemas, XML docs, diagnostics, or skills can express closer to the capability.

Default posture:

- Treat injected startup/status context as orientation and invalidation, not durable truth.
- Ask `Pe.Host` for fresh facts when current host/Revit/workspace state matters.
- Discover capabilities through generated operation metadata before inventing lower-level paths.
- Use scripts when code is the clearer or only reasonable way to express the work.
- Let diagnostics, artifacts, and follow-up reads prove the outcome.

## Agent Resources

- `pe_status` / `pea host status` - fresh host, bridge/session, active-document, workspace, and log-location facts.
- `pe_logs` / `pea host logs` - bounded log tails for failure diagnosis.
- `host_operation_search` / `pea host operation search` - generated public operation discovery.
- `host_operation_call` / `pea host operation call` - generated public operation execution.
- `script_bootstrap` / `pea script bootstrap` - create/update the host-owned scripting workspace.
- `script_execute` / `pea script execute` - execute inline or workspace C# scripts through the scripting contract.
- `revit_api_search` / `revit_api_fetch` - Revit API documentation lookup for API signatures and behavior.
- local file/search/edit/command tools - ordinary workspace work; do not hide these behind Pe-specific wrappers.

## Critical Entry Points

- `app/pea-instructions.ts` - Pea-specific agent orientation.
- `app/tools.ts` - Pe-specific Mastra tools.
- `app/host-operation-runtime.ts` - generated operation search/call runtime and client-side single-flight behavior.
- `../pe-tools/apps/pea/src/context-signals.ts` - snapshot-only Pea workbench context state-signal provider.
- `app/pea-agent.ts` - Pea `Agent` construction.
- `app/pea-runtime.ts` - Pea-owned runtime boundary over public Mastra Harness, Workspace, Memory, and auth seams.
- `app/main.ts` - human CLI command tree.
- `app/bundled-skill-content/pea-workflow-skills.ts` - optional packaged workflow recipes.
- `app/generated/host-client.generated.ts` - generated typed host client.
- `app/generated/host-operations.generated.ts` - generated operation catalog.

## Shared Language

| Term                       | Meaning                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| **pea**                    | Pe Agent; the public command/app surface.                                                    |
| **workbench**              | The scoped files, commands, tools, skills, and host operations available to the agent.       |
| **host fact**              | Runtime, filesystem, install, workspace, or session fact reported by `Pe.Host`.              |
| **transient context**      | Startup/status-change orientation injected into a thread; useful for orientation, not proof. |
| **host-operation catalog** | Generated capability metadata from C# host contracts.                                        |
| **scripting workspace**    | Host-created source/artifact area for C# scripts.                                            |
| **bridge lane**            | The serialized Revit-backed execution path through the private Host/Revit bridge.            |
| **artifact**               | Durable CSV/JSON/text output produced by a command or script.                                |

## Living Memory

- Keep Pea instructions and generated workspace docs orienting, not prescriptive. Put capability-specific guidance in operation metadata, XML docs, diagnostics, examples, or proven workflow skills.
- Pea is a thin product-policy wrapper over public Mastra seams. Keep using public Harness, Workspace, Memory, auth storage, protocol, `MastraTUI`, and `@mastra/core` seams rather than deep-importing framework internals.
- Prompt caching is a Pea invariant. Fix provider replay quirks locally instead of disabling caching broadly.
- Use host-reported paths and shared contracts for runtime/workspace facts. Do not hardcode local path conventions in TypeScript.
- Public host operations are the automation boundary. Avoid raw private bridge frames, broad schema dumps, or endpoint-specific wrappers unless repeated usage proves the surface earns its context.
- Scripts default to `ReadOnly`; `WriteTransaction` is explicit mutation intent and uses a host-owned transaction.
- Bridge-backed Revit operations share one serialized lane. Client-side queuing is an ergonomic helper; the host bridge gate is still the authority.
- Logs are diagnosis, not the main data path. Prefer them after status, operation calls, or script execution point at a host/Revit failure.
- Keep `pea` distinct from `pe-dev`; repo-local builds, runtime sync, and development validation are not part of the deployed agent model unless deliberately promoted.
- Pea API-key auth depends on scoping `APPDATA` to the Pea-owned `.pea` profile before MastraCode initializes its module-level auth storage. Do not add top-level `mastracode` runtime imports in Pea startup paths that run before `preparePeaAuth`; dynamically import MastraCode auth/TUI seams after the Pea auth profile is prepared.
