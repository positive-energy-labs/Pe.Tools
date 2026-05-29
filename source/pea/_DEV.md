# pea Development Notes

## Mental Model

`pea` is a scoped Revit/operator workbench for an agent. The product boundary is not "a safer coding agent"; it is a high-trust agent with normal local file/CLI agency plus a small set of Pe-specific tools for the places ordinary tooling cannot reach: live Revit state, Pe.Host diagnostics, C# script execution, Revit API documentation, and generated host-operation discovery/calls.

The agent should solve tasks by looping over observation, direct edits or host calls, validation, diagnostics, and verification. Boundaries should narrow the workbench and blast radius, not hide normal computer use behind wrapper tools.

## Architecture

- `app/agent.ts` is intentionally tiny: it creates the Pea runtime and runs MastraCode's `MastraTUI` without owning TUI rendering/input/thread UI.
- `app/pea-runtime.ts` is the Pea-owned runtime boundary. It resolves host/workspace facts, seeds skills/defaults, constructs the Pea agent, and calls `createMastraCode` with Pea policy.
- `app/pea-agent.ts` owns the `Agent`: dynamic Pea instructions, Pe tools, harness-provided workspace/model resolution, and Pea processors.
- `app/pea-context-seed.ts` creates transient per-thread context: startup orientation from workspace facts and compact Revit context when available, plus cheap host/session status-change detection on later turns.
- `app/pea-processors.ts` uses public `@mastra/core/processors` seams for Pea-specific compatibility and policy. It must not deep-import MastraCode internals.
- `app/pea-runtime-policy.ts` records only behavior-bearing runtime policy: `.pea` config, MCP disabled by default, prompt caching required, and OpenAI Responses compatibility enabled.
- `app/pea-instructions.ts` replaces generic coding-agent posture with Revit/operator guidance: injected context as orientation, explicit fresh status/context calls when exact session state matters, generated operations before scripts, scripts as first-class Revit tools, and verification after mutation.
- `app/tools.ts` exposes the small Pe-specific tool set: status, logs, scripting, Revit API docs, host-operation search, and host-operation call.
- `app/host-operation-runtime.ts` searches and invokes public generated host operations from `app/generated/host-operations.generated.ts`, preserving request hints, response hints, and preflight guidance.
- `app/pea-runtime-defaults.ts` owns Pea's MastraCode-compatible settings path and default model/runtime posture.
- `app/generated/host-client.generated.ts` is the typed host client generated from C# host operation contracts.
- `app/generated/host-operations.generated.ts` is the agent-facing capability catalog generated from the same C# contracts, including compact request/response shape summaries from exported host types.
- `app/bundled-skills.ts` writes product-owned workflow skills into `.pea/skills` before agent startup so installed runtime use gets the same recipes as repo-local use.
- `app/bundled-skill-content/pea-workflow-skills.ts` stores the bundled skill content separately from the writer.
- `app/main.ts` mirrors the key agent surfaces for humans: status, logs, script bootstrap/execute, operation search/list/call, defaults visibility, and `pea agent`.

## Key Flows

### Agent startup

1. Resolve host URL and workspace key from CLI/env/defaults.
2. Ask `Pe.Host` to bootstrap the scripting workspace and use the returned product-home path as the default agent cwd.
3. Seed/update Pea-owned settings at `.pea/settings.json` under the host-reported product/workbench root.
4. Ensure bundled Pea skills exist under the workspace's `.pea/skills` folder.
5. Create a best-effort context provider that caches one transient startup block per thread, then checks cheap host/session status on later turns and emits only compact invalidation notices when the stable status signature changes.
6. Start MastraCode through `createPeaRuntime()` with Pea's single primary `agent` mode, dynamic Pea instructions, Pea settings path, Pe-specific tools, and Pea processors.
7. Let `createMastraCode` own storage, memory, auth storage, thread handling, MCP/hook manager construction, workspace primitives, and harness lifecycle.
8. Run the returned harness through MastraCode's `MastraTUI` rather than a Pea-owned TUI fork.
9. Let normal workspace file/search/edit/command tools remain available inside the scoped workspace.

### Host operation discovery and call

1. C# host contracts define public operations and compact metadata: display name, domain, summary, tags, intent, bridge/document requirements, route, verb, type names, and shape hints from exported host types.
2. `pe-dev codegen sync --target host-client` regenerates the TypeScript client and operation catalog.
3. The agent searches the catalog by user intent with optional filters.
4. The agent uses `requestHint` / `requestShape` to form the JSON request and checks preflight notes before bridge/document-sensitive calls.
5. The agent calls a selected public operation by key with a JSON request.
6. Runtime errors preserve HTTP status/problem details and deterministic guidance so the agent can repair requests or report host/bridge failures accurately.

### Script loop

1. Use startup context as orientation and status-change notices as invalidation only; call `pe_status` for exact host/session/active-document facts, `revit.context.summary` for exact current user/Revit context, and `revit.context.visible-summary` for visible active-view contents.
2. Search host operations first; use a host operation instead of script when it fits.
3. Bootstrap the script workspace.
4. Write a small workspace-relative C# script with normal file tools.
5. Execute via `script_execute` / `pea script execute --source-path ...`.
6. Fix diagnostics and rerun.
7. For live mutations, verify with a follow-up read operation or script.

### Runtime defaults

Pea owns a MastraCode-compatible settings file under the host-reported product/workbench root. The seeded defaults intentionally make Pea an OpenAI-only Revit agent workbench rather than a generic coding-agent install:

- `custom:Pea OpenAI` model pack from the constants in `app/pea-instructions.ts`
- mode defaults for agent/build/plan/fast plus goal judge from `app/pea-runtime-defaults.ts`
- observer/reflector model overrides and OM thresholds from the Pea defaults summary
- `goalMaxTurns`, `yolo=true`, `thinkingLevel=medium`, quiet mode enabled, and `quietModeMaxToolPreviewLines=0`
- `theme=auto`
- prompt caching required
- OpenAI Responses item-reference compatibility enabled
- MCP disabled by default

Use `pea config defaults` to inspect the effective defaults, settings path, and behavior-bearing runtime policy. Use `pea config defaults --write` when a human wants to seed/update the file without launching the agent.

### Settings/profile validation loop

1. Read or create the settings/profile file directly.
2. Use host-operation search for settings schema/tree/document validate/open/save capabilities.
3. Call `settings.document.validate` when available.
4. Treat diagnostics as the source of truth, edit files directly, and revalidate.

## Open Questions

- Whether a readonly/oracle posture earns its UX weight after the single primary agent mode stabilizes.
- Which repeated operation calls deserve first-class convenience tools versus staying behind `host_operation_search` and `host_operation_call`.
- How much destructive-operation metadata is needed before real Revit mutation usage requires more than the current read/mutate intent flags.
- Whether MastraCode should grow public TUI policy seams for command hiding, onboarding/update visibility, model-picker visibility, or MCP UI visibility before Pea considers any TUI fork.
