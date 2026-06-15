---
name: pe-codify-work
description: Turn Pe.Tools conversations into repo-local durable artifacts such as PRDs, RFCs, refactor plans, issue-equivalent briefs, context docs, or AFK-ready task plans. Use when the user asks to codify, document this, write a PRD, make a plan, create an RFC, capture context, prepare AFK work, or preserve decisions without GitHub.
metadata:
  goal: true
---

# pe-codify-work

Use when the desired output is durable local work definition: PRD, refactor RFC, implementation plan, issue-equivalent brief, or AFK-ready task list.

## Dispatch

- If the conversation resolved durable project truth, update the nearest durable doc instead of creating a new artifact by default.
- If the user needs a temporary continuation record, use docs/context/.
- If the artifact is really a handoff, keep it short and consider pe-handoff.
- If the artifact would define future implementation, include verification criteria and stop conditions.

## Loop

1. Identify the artifact type and its home:
   - feature intent: docs/features/<feature>/\_GOALS.md
   - feature implementation context: docs/features/<feature>/\_DEV.md
   - package behavior: nearest AGENTS.md
   - package understanding/intent: local \_DEV.md / \_GOALS.md
   - temporary handoff/research: docs/context/
2. Read existing docs first and update in place when possible.
3. Consider consolidating, restructuring, or pruning existing docs.
4. Keep the artifact outcome-focused, bounded, verifiable, and repo-local.
5. Replace stale TODO prose with durable intent or delete it.
6. Include verification criteria and known risks/blockers.
7. Avoid GitHub issues/PRs/comments unless the user explicitly asks.

## Placement Rules

- Put durable agent behavior, workflow cautions, and shared language in the nearest AGENTS.md.
- Put conceptual orientation in \_DEV.md only when the area has a non-obvious mental model.
- Put desired end state, UX/DX intent, integration goals, and non-goals in \_GOALS.md.
- Put cross-package capability docs under docs/features/<feature>/ only when one package-local doc cannot own the story.
- Put temporary handoffs, research notes, and AFK context under docs/context/ and treat them as disposable.
- Delete stale root markdown after migrating the useful content; do not preserve history by default.
- Do not create a feature doc just because a topic feels important; create one when it spans ownership seams and needs a durable orchestration point.

Prefer concise docs that future agents can act on over exhaustive conversation history.

## Durability Checkpoint

The artifact itself is often the durable capture. Before finishing, confirm whether it updated the correct durable doc or explain why it belongs in temporary context instead.
