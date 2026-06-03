# pea app Development Notes

## Mental Model

This app hosts two products that share a TypeScript shell but not a persona.

Pea is the deployed Revit/operator workbench. It starts in a host-reported workspace, installs Pea workflow skills under `.pea/skills`, and exposes Pea product tools for host/Revit work.

dev-agent is the Pe.Tools repo coding agent. It should feel like normal MastraCode for source work, with extra verification and product-probing tools available when proof needs repo or Revit context.

## Architecture

- `main.ts` owns the human CLI tree. Keep `pea agent` for deployed Pea and a distinct dev command for the repo coding agent.
- `pea-runtime.ts` owns shared runtime policy and explicit runtime factories over `createMastraCode`.
- `pea-agent.ts` constructs only the deployed Pea operator agent.
- `dev-agent.ts` constructs the repo coding agent with MastraCode defaults preserved.
- `tools/pea/tools.ts` exports Pea product tools: status, logs, scripting, Revit API docs, and host-operation search/call.
- `tools/shared/live-loop.ts` owns the shared live-loop implementation used by dev-agent tools and the human `pea live status/sync/restart` Gunshi commands.
- `tools/dev/tools.ts` exports only narrow dev-agent repo verification wrappers: `live_loop_context`, `live_rrd_sync`, `live_rrd_restart`, `talk_to_pea`, sync-first `script_execute`, and `test`.
- `bundled-skills.ts` and `bundled-skill-content/` install Pea workflow skills into `.pea/skills`.
- `dev-agent-skill-content/` contains the small dev-agent-only goal skill surface installed into project-scoped MastraCode skill roots: `pe-steer`, `pe-diagnose`, `pe-live-loop`, `pe-tdd`, `pe-architecture`, `pe-codify-work`, `pe-handoff`, and `pe-write-skill`.

## Provenance Rules

- Coding behavior comes from MastraCode defaults: modes, subagents, file/search/edit tools, shell tools, memory, and TUI behavior.
- Live Revit/operator facts come from Pea product tools and `Pe.Host`, not repo source assumptions.
- Repo workflow semantics come from repo commands and docs, especially `pe-dev`, `docs/ENVIRONMENT.md`, `./build`, installer logic, MSBuild props, and package-local `AGENTS.md` files.
- Complex multi-step repo practices belong in dev-agent-only skills.
- Hooks and custom slash commands are not installed by default; hooks are reserved for future narrow unsafe-action guardrails.
- Repo verification wrappers must report what their result proves and does not prove, especially around NoRrdContact, RrdRequired, sync runtime freshness (`fresh`/`stale`/`unproven`), and FreshRevitProcess.
- `pea live status` is the single human-facing live-loop status packet; installed payload metadata lives under `pea runtime payload` to avoid competing runtime-status meanings.
- `pe-dev` is an optional fallback for FreshRevitProcess helper workflows, not a startup gate or live-loop dependency for dev-agent.

## Key Flows

### Pea startup

1. Resolve host/workspace arguments.
2. Ask `Pe.Host` for workspace/runtime facts when needed.
3. Seed Pea settings under `.pea`.
4. Install Pea bundled workflow skills under `.pea/skills`.
5. Start MastraCode with Pea instructions and Pea product tools only.

### dev-agent startup

1. Resolve the repo workspace root.
2. Preserve any existing root `AGENTS.md`; otherwise install a managed `.mastracode/AGENTS.md` block.
3. Seed project-scoped dev-agent skills in a normal MastraCode skill location for this repo.
4. Do not install hooks or slash commands by default.
5. Start MastraCode with default modes/subagents/tools intact.
6. Add Pea product tools and the curated repo verification tools as extras.
7. Keep repo workflow guidance in dev-agent instructions and skills, not in Pea.

### Black-box product feedback

1. dev-agent changes source directly.
2. It proves compile/package/runtime behavior through normal tools and narrow repo wrappers.
3. When product behavior matters, it uses `talk_to_pea` to delegate to the real Pea operator agent in a stateful thread.
4. It frames Pea turns as `operator`, `feedback`, or `collaborate` depending on whether it needs a user-facing answer, product/harness critique, or Revit/project convention exploration.
5. It reports observed harness/product behavior back into the source-editing loop.

## Open Questions

- Whether the long-term human-facing command should remain under `pea dev` or move to a separate PATH name.
- Which repeated repo workflows deserve dev-agent skills after real usage proves the pattern.
