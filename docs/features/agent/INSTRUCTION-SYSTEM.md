# Pea instruction system

Pea has no prompt compiler. The lab harness (Claude Code or Codex, ADR 0015) composes the provider
request, and each Pea rule has exactly one carrier. Do not judge Pea's behavior from a source
string: the harness owns the final request and Pea cannot capture it.

| Concern | Owner | Rule |
|---|---|---|
| Identity, authority, evidence, loop, voice | `peaAgentInstructions` (`@pe/mcps` `pea/instructions.ts`, static kernel) | Capability-neutral. Names no tool that can be absent. Reaches Claude as the MCP server `instructions` (`createPeaMcpServer`). |
| Kernel carrier for Codex | `developer_instructions` in `CODEX_CONFIG` (`childEnv` in `harness/threads.ts`) | Codex ignores MCP `instructions`, so the host writes the kernel and `CODEX_QUESTION_RULE` there. |
| Revit routing | `pe_find` discovery and the generated operation catalog | Connections and the selected document are volatile. The kernel never states them. |
| Workspace root and containment | The harness child's cwd (`worldRoot`) | The kernel never hardcodes a path. |
| Which tools exist and what they do | `peaProductTools` descriptions and generated host-operation metadata | Routing stays local to the tool description. |
| Who may call what | The harness permission mode, rendered as `permission_request` cards | Pea holds no tool-category policy. |
| Reusable workflow judgment | Bundled skills in `@pe/mcps` `pea/skills.ts`, materialized under the product home for each harness root | Each skill is a method with a crisp trigger. Materialization removes only `retiredPeaSkillNames`; user skills are never touched. |
| Durable user and project facts | The harness's own memory and context | Pea keeps no memory layer. |
| Pod-authoring rules at the moment of authoring | Generated workspace docs, C#-owned (`Pe.Revit.Scripting/Bootstrap/ScriptFileTemplates.cs`) | The harness reads the workspace `AGENTS.md` from its cwd. It and `build-pod` must agree; nothing enforces that yet. `AGENTS.md` rewrites on bootstrap, `README`/`JOIN_GUIDE` are create-once. |
| Current document orientation | None | Return only with source, observation time, and clear-on-absence. |

## Skill set

Practitioner-facing, adapted from the repo stance set: `survey-revit-model` (ground),
`diagnose-revit-behavior` (diagnose, carries the view-visibility cause list), `settle-intent`
(grill), `prove-revit-change` (prove), `teach-revit-mechanism` (teach),
`write-revit-csharp-script` (execute for Revit), `build-pod` (demiurge + close + purge, owns the
Pod definition and adapting an existing Pod), `propose-changes` (the one collaboration grammar on every route: Pea proposes, the person stages, a human verb commits), `place-mep-ducts` (unchanged).
Not exposed: index, docs, relay, delegate, goal, mine, reflect, protoui, house.

## Proof

`ts/packages/mcps/tests/pea-instructions.test.ts` pins the neutral kernel and the MCP discovery path;
`ts/packages/mcps/tests/pea-skills.test.ts` pins skill frontmatter and retired-name materialization.
