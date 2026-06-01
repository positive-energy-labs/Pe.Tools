# pea app

## Scope

Owns the TypeScript CLI/runtime entrypoints for two separate products:

- **Pea**: the deployed Revit/operator workbench started with `pea agent`.
- **dev-agent**: the Pe.Tools repo coding agent started through the TS CLI dev surface.

## Purpose

Keep Pea and dev-agent separate even when they share bootstrap code. Pea is a product/runtime workbench over `Pe.Host`, host operations, scripts, Revit API docs, logs, and bundled Pea workflow skills. dev-agent is a MastraCode-based source-editing agent for this repo that may use Pea only as a black-box product feedback harness.

## Philosophy

Ruthlessly weigh the context and optionality cost of additional tools, host operations, and tool arguements. Equally as important is guiding agent behavior by thoughtfully curating the available tools/skills or by enabling effortless/serendipitous access to critical context. This is as opposed to maintaining large system instructions or the like. Pea and dev-agent have different context provenance set ups, but both should strive towards this goal. The push and pull of adding potentially helpful features and pruning/consolidating them is to be expected. Work with the Pea and your user to distill the highest signals from these ebbs. Always aim for more of an 80/20 rule approach.

## Product Contract

- `pea agent` must not know repo source, build topology, RRD/Rider state, `pe-dev`, package-local DLLs, or repo-only skills.
- dev-agent edits source directly with normal MastraCode coding tools, modes, and subagents.
- dev-agent may use Pea product tools for host/Revit facts, scripts, operation calls, and black-box product review.
- dev-agent repo wrappers are proof/diagnostic tools, not its primary coding loop.
- Complex repo workflows belong in dev-agent-only project-scoped skills, not in Pea bundled skills and not as a broad duplicate CLI.
- Do not leak dev-agent instructions, repo tools, or repo workflow skills into installed Pea.

## Critical Entry Points

- `main.ts` - CLI routing for Pea, dev-agent, and direct utility commands.
- `pea-runtime.ts` - runtime factory boundary around `createMastraCode`.
- `pea-agent.ts` - deployed Pea operator agent construction.
- `dev-agent.ts` - repo coding agent construction.
- `pea-instructions.ts` - Pea-only operator instructions.
- `dev-agent-instructions.ts` - dev-agent-only coding/product-verification instructions.
- `tools/pea/tools.ts` - Pea product tool exports.
- `tools/dev/tools.ts` and `tools/dev/live-rrd.ts` - dev-agent repo verification wrappers.
- `bundled-skills.ts` and `bundled-skill-content/` - Pea-installed workflow skills.
- `dev-agent-skill-content/` - dev-agent-only skill source.

## Shared Language

| Term | Meaning |
| --- | --- |
| **Pea** | Deployed Revit/operator agent product, normally `pea agent`. |
| **dev-agent** | MastraCode-based Pe.Tools repo coding agent. |
| **Pea product tools** | Host/Revit/product tools such as status, logs, host operations, scripts, and Revit API docs. |
| **repo verification tools** | Narrow dev-agent wrappers around live-loop context, live-RRD sync/restart, sync-first scripting, FreshRevitProcess/AttachedRrd tests, plus black-box Pea review. |
| **black-box product feedback** | Running the real Pea operator agent through `talk_to_pea`, then using observed behavior to improve source. |

## Living Memory

- Prefer explicit product factories over a `kind: "operator" | "repo-dev"` merge that makes dev-agent look like a Pea persona.
- Keep MastraCode defaults intact for dev-agent unless a product requirement demands a narrow override.
- `live_rrd_sync` is a required live-validation concept for AttachedRrd freshness. Isolated builds are compile proof, not loaded-runtime proof.
- `pe-dev` is only a fallback for FreshRevitProcess helper workflows; dev-agent live-loop wrappers must not depend on it.
- Keep dev-agent skills in normal project-scoped MastraCode skill locations for this repo. Keep installed Pea skills under `.pea/skills` only.
