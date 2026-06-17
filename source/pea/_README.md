# pecoelopment Notes

## Mental Model

`pea` is a scoped Revit/operator workbench for an agent. It adds Pe-specific orientation and resources to a normal local agent runtime: `Pe.Host` status, generated host operations, C# scripting, Revit API docs, logs, artifacts, and ordinary workspace file/command tools.

The intended direction is architecture-led behavior. The prompt should orient the agent; the harness, tool schemas, generated operation metadata, XML docs, diagnostics, and artifacts should steer task-specific choices.

## Architecture

- `app/agent.ts` starts the Pea runtime through MastraCode's `MastraTUI` renderer.
- `app/pea-runtime.ts` is the Pea-owned boundary over public Mastra Harness, Workspace, Memory, and auth seams.
- `app/pea-agent.ts` constructs the `Agent`, tools, dynamic instructions, workspace/model resolution, and processors.
- `../pe-tools/apps/pea/src/context-signals.ts` provides snapshot-only Pea workbench context state signals.
- `app/pea-instructions.ts` contains only Pea-specific orientation and boundaries.
- `app/tools.ts` exposes the small Pe-specific tool set.
- `app/host-operation-runtime.ts` searches/calls generated public operations and serializes bridge-backed calls client-side.
- `app/generated/host-client.generated.ts` is the generated typed client slice.
- `app/generated/host-operations.generated.ts` is the generated operation catalog.
- `app/bundled-skill-content/pea-workflow-skills.ts` stores optional workflow recipes.
- `app/main.ts` mirrors the key surfaces for humans.

## Key Flows

### Agent startup

1. Resolve host URL and workspace key from CLI/env/defaults.
2. Ask `Pe.Host` to bootstrap the scripting workspace and report host-owned paths.
3. Seed/update Pea-owned settings under the host-reported product/workbench root.
4. Seed packaged skills when configured.
5. Create transient context for orientation and status-change invalidation.
6. Start MastraCode with Pea instructions, tools, settings, and processors.

### Capability use

1. Use fresh status/context only when the task depends on current runtime or Revit state.
2. Use generated operation discovery/calls for public host capabilities.
3. Use scripts for code-shaped work or gaps in the public operation surface.
4. Use docs for API signatures and behavioral remarks.
5. Use diagnostics, artifacts, follow-up reads, or logs to prove the result.

### Scripting

- Bootstrap gives the workspace, references, sample, and guidance files.
- Inline execution is for tiny probes.
- Workspace-path execution is for durable or multi-step scripts under `src/`.
- `ReadOnly` is the default permission mode; `WriteTransaction` is explicit mutation intent.

## Open Questions

- Which repeated workflows deserve packaged skills versus remaining discoverable through generated metadata and scripts.
- Which host-client helpers deserve hand-maintained XML-doc guidance after real usage proves the pattern.
