# Pea instruction system

Pea has no prompt compiler. The provider request is composed by native Mastra owners, and every
rule has exactly one of them. Do not judge Pea's behavior from a source string: the two captures
(`system-prompt-capture.ts`, `tool-list-capture.ts`) record the latest system text and a lossy
tool summary from the most recent provider call, independently and uncorrelated. They are
inspection aids, not an exact resolved request.

| Concern | Owner | Rule |
|---|---|---|
| Identity, authority, evidence, loop, voice, the `<user delivery="while-active">` wire | `peaAgentInstructions` (static kernel, ~500 tokens) | Capability-neutral. Names no tool that can be absent. |
| Revit routing hint | `peaRevitOrientation` | Appended by `peaAgentInstructionsFor` only when `capabilities.revit` is true, the same flag that admits Revit tools. The runtime defaults closed; the root TUI/ACP, `pea --prompt`, and the default host assert Revit. |
| Workspace root, containment, granted paths | Mastra Workspace processor | Kernel never hardcodes a path. |
| Which tools exist and what they do | Tool definitions and generated host-operation metadata | Routing stays local to the tool description. |
| Who may call what | `resolvePeaToolCategory` + access-level policies | Every provider-visible name (product, native `mastra_workspace_*`, `skill*`) resolves to an intentional category; unknown names fall to `other`, which all levels deny. The category names the door, not the effect behind it. |
| Reusable workflow judgment | Bundled skills in `@pe/mcps` `skills.ts`, materialized under the product home | Each skill is a method with a crisp trigger. Materialization removes only `retiredPeaSkillNames`; user skills are never touched. |
| Durable user and project facts | Observational Memory (`memory/profiles.ts`) | Live Revit/runtime state is excluded by the observer instruction. |
| Active task state | `TaskSignalProvider` | One signal owner; no Pea copy. |
| Current document orientation | None yet | The old context signal is deleted: it had no producer and replayed stale snapshots. Return only with source, observation time, and clear-on-absence. |

## Skill set

Practitioner-facing, adapted from the repo stance set: `survey-revit-model` (ground),
`diagnose-revit-behavior` (diagnose, carries the view-visibility cause list), `settle-intent`
(grill), `prove-revit-change` (prove), `teach-revit-mechanism` (teach),
`write-revit-csharp-script` (execute for Revit), `build-pod` (demiurge + close + purge, owns the
Pod definition and adapting an existing Pod), `author-pe-settings` (three former settings/profile skills, proposing through `route:settings`), `place-mep-ducts` (unchanged).
Not exposed: index, docs, relay, delegate, goal, mine, reflect, protoui, house.

## Proof

`packages/runtime/tests/pea-instructions.test.ts` pins the neutral kernel, the conditioned
orientation, the wire tag, native-name classification, and skill frontmatter validity.
