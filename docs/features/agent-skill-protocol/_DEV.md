# Agent Skill Protocol Development Notes

## Mental Model

There are three different extension surfaces, and they should not compete:

- **Commands** start human/admin entrypoints such as `pea agent` and `pea dev`.
- **Skills** encode repeated agent workflows and shared decision loops.
- **Hooks** guard narrow unsafe actions only when instruction is not enough.

The visible workflow surface should stay small. The current dev-agent surface is `pe-steer`, `pe-diagnose`, `pe-live-loop`, `pe-tdd`, `pe-architecture`, `pe-codify-work`, `pe-handoff`, and `pe-write-skill`.

## Architecture

- `source/pea/app/main.ts` owns the CLI entrypoints.
- `source/pea/app/pea-runtime.ts` owns separate Pea and dev-agent runtime factories.
- `source/pea/app/bundled-skill-content/` owns Pea product workflow skills.
- `source/pea/app/dev-agent-skill-content/` owns dev-agent repo workflow skills.
- `source/pea/app/dev-agent-project-files.ts` seeds project-scoped dev-agent instructions/skills without overwriting root repo guidance.
- `source/pea/app/repo-dev-tools.ts` owns narrow proof wrappers around repo diagnostics/build/sync/test/logs/pack workflows.

## Key Flows

### Pea

1. `pea agent` resolves host/workspace facts.
2. The runtime seeds Pea settings and bundled Pea workflow skills under `.pea`.
3. Pea starts with Pea instructions and Pea product tools only.
4. Pea does not load repo verification tools, dev-agent instructions, or dev-agent workflow skills.

### dev-agent

1. `pea dev` resolves a repo workspace root.
2. Existing root `AGENTS.md` remains authoritative; otherwise a managed `.mastracode/AGENTS.md` block can be installed.
3. Dev-agent skills are written under `.mastracode/skills`.
4. Hooks and slash commands are not installed by default.
5. MastraCode starts with normal coding defaults plus Pea product tools and narrow repo verification wrappers.

### Promotion rule

A repeated workflow starts as ordinary instructions or a one-off plan. Promote it to a skill only when naming the workflow reduces repeated steering. Promote to a command only when a human/admin launch or prompt macro is repeatedly useful outside agent reasoning. Promote to a hook only when a narrow unsafe action needs a blockable guardrail.

## Open Questions

- Which Pea product workflows should stay as bundled skills versus being discoverable only through host-operation metadata.
- Which dev-agent workflows survive real use and deserve to remain in the small visible surface.
