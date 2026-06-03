# pea app

## Scope and Purpose

Keep Pea and dev-agent separate even when they share bootstrap code. Pea is a product/runtime workbench over `Pe.*` namespace packages, `Pe.Host`, host operations, scripts/script workspaces, Revit API docs, logs, and bundled Pea workflow skills. dev-agent is a MastraCode-based source-editing agent for this repo (C# *and* TS inclusive) that may use Pea only as a black-box product feedback harness.

- **Pea** is the deployed Revit/operator workbench. It is a user-facing product. It must never receive repo-source posture, coding-agent instructions, Pe.Tools contributor assumptions, or dev-only skills.
- **dev-agent** is the Pe.Tools repo coding agent. It exists to improve Pea and the broader Pe.Tools ecosystem. It may use Pea only as a black-box product feedback harness.

The shared north star is Pea as a highly capable operator of Pe.Tools. This does not mean Pea should know everything by default. It means Pe.Tools capabilities must be exposed through strong public seams: typed host APIs, documented C# scripting APIs, generated doc-like artifacts, stable shared contracts, and domain workflows that map to real operator intent.

The modules that let context and behavior travel cleanly across product surfaces are strategically important and should be consolidated aggressively: settings runtime, scripting, Revit data contracts, storage schemas, host operations, generated documentation, and other shared capability contracts. Duplicate-but-similar shapes are not harmless. They make the agent world larger and less trustworthy.

## Philosophy

YOU MUST READ `./PHILOSOPHY.md`. The gist: ruthlessly and aggresively weigh the decision cost of options against the expected gain from an additional tools, host operations, tool arguements, skills, etc. and *ALWAYS* strive to embed core operating loops in the harness itself. The push and pull of harness capabilities is expected, work with your user (and Pea if your dev-agent) to distill the highest signals from these ebbs. Always aim for more of an 80/20 rule approach.

## Critical Entry Points

- `main.ts` - CLI routing for Pea, dev-agent, and direct utility commands.
- `pea-runtime.ts` - runtime factory boundary around `createMastraCode`.
- `pea-agent.ts` - deployed Pea operator agent construction.
- `dev-agent.ts` - repo coding agent construction.
- `tools/shared/live-loop.ts` - shared live-loop status/sync/restart implementation used by dev-agent tools and `pea live ...`.
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
- Keep dev-agent skills in normal project-scoped MastraCode skill locations for this repo. Keep installed Pea skills under `.pea/skills` only.
- Keep live-loop status singular: `pea live status` and `live_loop_context` share one implementation; installed payload metadata belongs under `pea runtime payload`.
