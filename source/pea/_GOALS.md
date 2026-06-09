# pea Goals

## North Star

`pea` is the Pe Agent entrypoint: a high-trust Revit/operator workbench that lets an agent use local files, CLI commands, scripts, diagnostics, and public `Pe.Host` operations to produce useful Revit outcomes without exposing repo internals or private bridge plumbing.

## User Goals

- Give users one obvious way to start agent-assisted Revit work: `pea agent`.
- Make the agent feel like it is driving Revit and the user's Pe workspace, not like a generic coding agent.
- Keep the public experience centered on intent, validation, and observed Revit state instead of runtime plumbing.
- Start from deterministic Pea-owned agent defaults instead of inheriting generic MastraCode model/settings posture.
- Let users and agents build custom workflows against the same generated host-operation surface.

## Developer Goals

- Keep `pea` close to public Mastra/MastraCode extension seams instead of forking a separate agent framework.
- Assemble Pea through public Mastra Harness, Workspace, Memory, auth, and protocol seams so Pea owns product policy while Mastra owns reusable runtime primitives and TUI rendering.
- Use public `@mastra/core` processor seams for Pea-specific input/error handling, including OpenAI Responses item-reference compatibility.
- Trust the model with normal filesystem, search, edit, and command agency inside the scoped workspace.
- Keep Pe-specific tools small and load-bearing: status, logs, scripting, Revit API docs, host-operation discovery, and host-operation calls.
- Treat host-operation metadata and generated TypeScript catalogs as the capability map for agent discovery, including generated request/response shape hints.
- Use validators and diagnostics as the steering loop for settings, profiles, scripts, and Revit mutations.
- Keep Pea settings user-editable while seeding a strong default model, OM, goal, quiet-output, MCP, and cache/compatibility posture.
- Treat prompt caching as always allowed; avoid fixes that broadly disable caching to work around provider-side replay metadata.

## Integration Goals

- Use `Pe.Host` as the public automation boundary for Revit-backed capabilities.
- Generate agent-facing host-operation metadata from the C# host contract catalog and exported host type metadata.
- Prefer `host_operation_search` plus `host_operation_call` over endpoint-specific wrappers unless repeated use proves a wrapper is worth the context.
- Package Pea workflow skills with the runtime so installed `pea agent` has executable recipes by default.
- Keep the default workspace under the host-reported Pe product/workbench root; use user Documents/Pe.Tools space for authored/operator files when that is the host-reported convention, not from TypeScript guesses.
- Install `pea` through the MSI as the PATH-friendly deployed agent command alongside Host/App.
- Keep `pe-dev` available for repo-local development, validation, runtime sync, and operational tasks, but do not install it through the MSI.

## Non-Goals

- `pea` is not a second `pe-dev` or a repo build/test operator.
- `pea` should not independently encode Pe runtime path conventions or hardcode `Documents/Pe.Tools` without a host-reported path.
- `pea` should not expose implementation details of the private Revit bridge.
- `pea` should not bury ordinary file/CLI work behind custom wrapper tools.
- `pea` should not grow a broad permission framework before real product usage demands it.
- `pea` should not fork `MastraTUI` or deep-own storage/MCP/hooks/auth/thread primitives unless public seams fail a concrete product requirement.
- `pea` should not hide MastraCode TUI options through private hacks; pursue small public/upstreamable TUI policy seams first.
