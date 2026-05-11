# pea

## Scope

Owns the deployed Pe Agent command/app surface and the resources exposed to an agent working through `Pe.Host`.

## Purpose

`pea` is the agent-owned user surface for Pe tooling. It should give an agent a small, typed, reliable set of resources for useful Revit work instead of exposing repo internals, raw endpoint sprawl, or dev/operator workflows.

## Deployed Agent World

Assume the Pe Agent is running on a user's machine with these resources available:

- a local MSI-installed `pea` command surface available on PATH
- a reachable local `Pe.Host` HTTP server
- a private `Pe.Host` to Revit bridge when Revit is open and connected
- a Pe scripting workspace rooted at a host-reported filesystem path
- generated TypeScript host client methods for the public operations selected for agent use
- local workspace files that the agent can read/write before asking Revit to execute a script
- host and Revit logs exposed through typed host operations

Do not assume the deployed agent has repo source paths, build outputs, `pe-dev`, Rider/RRD state, package-local DLLs, or developer-only validation commands. Those belong to repo development, not the agent's runtime experience.

## Agent Resources

The agent-facing resources should stay boring and typed:

- `host.getStatus` - the first startup call; health, bridge/session state, active document facts, contract versions, and host-owned filesystem locations
- `host.getLogs` - bounded host/Revit log tails for diagnosis after status or execution indicates a failure
- `scripting.bootstrapWorkspace` - create/update the script workspace and return host-owned paths
- `scripting.execute` - execute either an inline snippet or a workspace-relative C# script through Revit
- local workspace file access - create/edit script files in the resolved workspace before execution

Prefer adding small generated-client operations when the agent needs a new capability. Avoid giving the agent broad raw HTTP access, giant schema/tool dumps, private bridge frames, or repo-local dev commands as a substitute for an intentional public operation.

## Critical Entry Points

- `app/main.ts` - `pea` command tree and human CLI output.
- `app/agent.ts` - Mastra agent runtime wiring and Pe host tool registration.
- `app/pe-host.ts` - host/workspace defaults and generated-client construction.
- `app/generated/pe-host-client.ts` - generated TypeScript client for selected public host operations.
- `_GOALS.md` - durable intent for the public Pe Agent surface.

## Shared Language

| Term | Meaning | Prefer / Avoid |
| --- | --- | --- |
| **pea** | Pe Agent; the public agent-owned command/app surface | Prefer this over treating it as a generic umbrella CLI |
| **agent resource** | A typed capability the deployed agent can actually use | Avoid documenting repo-only tools as if they are deployed resources |
| **host fact** | Runtime, filesystem, install, workspace, or session fact reported by `Pe.Host` | Avoid hardcoded TypeScript guesses for paths or runtime state |
| **workspace path** | A host-created Pe scripting workspace root | Prefer host bootstrap/status over local path assumptions |
| **generated client** | The TypeScript client emitted from shared host operation contracts | Prefer this over handwritten fetch wrappers |

## Living Memory

- Keep `pea` oriented around agent workflows and generated host contracts.
- The deployed agent's first command in a new thread should be `pea host status --json`; use that response for bridge readiness, active document, scripting workspace root, settings root, and log paths.
- Use `pea host logs` only as a bounded follow-up after status or script execution points at a host/Revit failure.
- The scripting workspace is the agent's primary working directory; scripts should be authored there and executed through `scripting.execute`.
- Do not let `pea` grow into a second `pe-dev`; repo-local validation, runtime sync, builds, and operator flows stay outside the deployed agent model unless deliberately promoted as public host operations.
- The MSI installs `pea`, not `pe-dev`; keep installer/package changes aligned with that product boundary.
- Local path conventions are critical but should come from `Pe.Host` or shared contracts, not hardcoded TypeScript defaults.
- Prefer small typed tools over broad endpoint or schema dumps in the agent context.
