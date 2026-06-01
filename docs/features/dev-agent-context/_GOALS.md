# North Star

Dev-agent should be a thin, reliable Pe.Tools repo workbench that routes to fat, high-value workflow skills instead of carrying every workflow in always-loaded instructions.

The harness should preserve a small set of invariants: Pea and dev-agent are separate products, proof lanes must not be confused, natural-language skill triggering is the primary UX, and durable project truth belongs in Pe-native docs before implementation drifts away from shared intent.

# User Goals

- Natural requests such as "grill me", "I don't like this", "where should this live", "why is this failing", and "continue this later" should activate the right workflow without requiring explicit `/skill` commands.
- Explicit `/skill ...` should remain useful as an override/debug affordance, not the expected primary workflow.
- High-traffic Pe.Tools loops should feel like reusable agent programs: steering, live Revit/RRD coordination, diagnosis, architecture, and skill authoring.
- Agents should ask fewer low-value questions and instead use repo docs, generated contracts, logs, and source context to resolve what they can.
- Shared decisions should not silently vanish into transcripts.

# Developer Goals

- Keep `source/pea/app/dev-agent-instructions.ts` as a thin router and invariant layer.
- Put detailed workflow behavior in generated dev-agent skills, especially the high-traffic/failure-prone skills.
- Write skill descriptions as blunt routing metadata with literal user phrases and failure-mode smells, not elegant prose.
- Keep resolver behavior Pe-native: nearest `AGENTS.md`, `_GOALS.md`, `_DEV.md`, `docs/features`, generated contracts/docs, and existing runbooks are the substrate.
- Avoid introducing Matt-style `CONTEXT.md` or ADR conventions unless a future explicit design pass replaces the Pe.Tools documentation model.
- Avoid a standalone resolver skill until repeated cross-skill resolver pain proves it deserves a named surface.
- Keep this pass pure markdown/TypeScript skill content. Scripts/assets belong in skills only after repeated deterministic helper logic proves safer than regenerated commands.

# Docs-First Durability

When a skill resolves reusable project truth, durable capture happens before source implementation.

Capture durable changes when work resolves:

- shared language or renamed concepts
- product/workflow boundaries
- repeated failure modes
- north-star intent, non-goals, or philosophy
- architecture rules or public-seam guidance
- verification/proof-lane rules

In Build/default mode, update the nearest durable doc first. In Plan/read-only mode, make the doc update the first step of the submitted plan and do not pretend capture happened. If no durable capture is needed, say why explicitly.

# Pea Relationship

Pea is the deployed Revit/operator workbench this repo exists to improve. Dev-agent may use Pea only as a black-box product feedback harness: ask operator-like questions, observe behavior, and feed that evidence back into source and docs.

Longer-term, Pea skills can become workflow programs over deterministic product surfaces:

- typed host operations
- generated operation/schema docs
- C# Revit scripting
- Pe libraries
- scripts/assets only when the deterministic helper is repeated and safer than regenerated code

The skill supplies judgment and orchestration. Host operations, scripts, and Pe libraries supply deterministic Revit behavior.

# Non-Goals

- Turning dev-agent into Pea or leaking repo development posture into installed Pea.
- Moving detailed workflow loops into always-loaded instructions.
- Creating a new resolver skill in this pass.
- Adding scripts/assets to dev-agent skills in this pass.
- Creating `CONTEXT.md`, `CONTEXT-MAP.md`, or ADR conventions in this pass.
- Manually editing generated `.mastracode/skills` as source.
- Editing `source/pea/app/dist` directly.


---

Clean up
see changes of tool names
The live loop verification lane splits like
