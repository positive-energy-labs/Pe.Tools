# Pea instruction system

Pea has no prompt compiler. The lab harness (Claude Code or Codex, ADR 0015) composes the provider
request, and each Pea rule has exactly one carrier. Do not judge Pea's behavior from a source
string: the harness owns the final request and Pea cannot capture it.

| Concern | Owner | Rule |
|---|---|---|
| Identity, authority, evidence, loop, voice | `peaAgentInstructions` (`@pe/mcps` `pea/instructions.ts`, static kernel) | Owns product posture; discovery owns volatile availability. Claude receives the whole kernel through `systemPrompt.append` (`harness/threads.ts:849`), because Claude Code truncates MCP server instructions. The MCP server also publishes it; that carrier alone is insufficient. |
| Kernel carrier and isolation for Codex | `developer_instructions` in `CODEX_CONFIG` (`childEnv` in `harness/threads.ts`) | Codex ignores MCP `instructions`, so the host writes the kernel and `CODEX_QUESTION_RULE` there. Product-root config disables personal MCP servers and memories (`harness/user-shell.ts`); Claude uses only project/local settings. This is configuration isolation, not a filesystem sandbox. |
| Revit routing | `pe_find` discovery and the generated operation catalog | Connections and the selected document are volatile. The kernel never states them. |
| Workspace root and containment | The harness child's cwd (`worldRoot`) | The kernel never hardcodes a path. |
| Which tools exist and what they do | `peaProductTools` descriptions and generated host-operation metadata | Routing stays local to the tool description. |
| Who may call what | The harness permission mode, rendered as `permission_request` cards | Pea holds no tool-category policy. |
| Reusable workflow judgment | Bundled skills in `@pe/mcps` `pea/skills.ts`, materialized under the product home for each harness root | Each skill is a method with a crisp trigger. Materialization deletes a folder only when the product receipt proves it wrote those bytes (retired names included); any other folder is left byte-exact with one notice naming its path. |
| Durable user and project facts | The harness's own memory and context | Pea keeps no model-memory layer. Personal agent memory is excluded; document-scoped ruled facts remain an open design in the [ledger](LEDGER.md). |
| Pod-authoring rules at the moment of authoring | Generated workspace docs, C#-owned (`Pe.Revit.Scripting/Bootstrap/ScriptFileTemplates.cs`) | The harness reads the workspace `AGENTS.md` from its cwd. It and `build-pod` must agree; nothing enforces that yet. `AGENTS.md` rewrites on bootstrap, `README`/`JOIN_GUIDE` are create-once. |
| Current document orientation | None | Return only with source, observation time, and clear-on-absence. |

## Skill set

`bundledPeaSkills` in `ts/packages/mcps/src/pea/skills.ts` owns the current names and triggers.
It includes practitioner investigation, scripting, family/Pod authoring, Pages, proposals and ducts.
Repo dispatch, capture, delegation and UI-design stances are not product capabilities.
Do not duplicate the bundle as a fixed list here.

## Proof

`ts/packages/mcps/tests/pea-instructions.test.ts` pins the neutral kernel and the MCP discovery path;
`ts/packages/mcps/tests/pea-skills.test.ts` pins skill frontmatter and retired-name materialization.
Carrier trace checked at `a553a15a` on 2026-10-22; these tests were not rerun in that documentation pass.
The prior Claude kernel-tail/no-personal-plugin probe remains recorded in [LEDGER.md](LEDGER.md);
source configuration alone does not prove provider behavior.
