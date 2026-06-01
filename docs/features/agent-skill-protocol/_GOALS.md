# Agent Skill Protocol Goals

## North Star

Pe.Tools agents should feel like a small set of durable workflows, not a pile of prompts, commands, hooks, and duplicated CLIs. Pea stays a deployed Revit/operator workbench; dev-agent stays the repo coding agent with Pea available only as a black-box product feedback harness.

## User Goals

- Start Revit/operator work with `pea agent` and get product-facing Pea behavior only.
- Start repo coding work with `pea dev` and get normal MastraCode source-editing behavior plus Pe.Tools workflow guidance.
- Reach for a tiny, memorable skill surface when work needs steering, diagnosis, fragile live-loop coordination, TDD, architecture review, local work capture, handoff, or skill authoring.
- Keep context and task management repo-local by default.

## Developer Goals

- Keep human/admin launch surfaces as CLI commands.
- Keep repeated agent workflows as small project-scoped skills, goal-enabled when autonomous execution is useful.
- Keep hooks rare and limited to narrow unsafe-action guardrails.
- Keep repo verification wrappers small, provenance-rich, and proof-oriented.
- Preserve MastraCode defaults for dev-agent unless a narrow product requirement demands an override.

## Integration Goals

- Pea bundled skills install only under `.pea/skills` and remain product/runtime oriented.
- dev-agent workflow skills install only under project-scoped MastraCode skill roots.
- Pea product tools provide black-box host/Revit feedback for dev-agent without teaching Pea repo posture.
- Repo docs use the local taxonomy: `AGENTS.md`, `_DEV.md`, `_GOALS.md`, `docs/features/`, and `docs/context/`.

## Non-Goals

- Do not turn Pea into a repo source reviewer or build/test runner.
- Do not turn dev-agent repo wrappers into a duplicate `pe-dev` or `dotnet` CLI.
- Do not create GitHub issues/PRs/comments as the default work-management path.
- Do not add slash commands or hooks for workflows that skills can express clearly.
