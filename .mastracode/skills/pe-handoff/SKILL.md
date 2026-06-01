---
name: pe-handoff
description: Create concise Pe.Tools handoff or resume context for another agent, later session, or AFK continuation. Use when the user says handoff, pause here, continue later, resume this, give the next agent context, summarize current state, or prepare an exact next-step packet.
metadata:
  goal: true
---

# pe-handoff

Use when work is pausing, changing hands, or needs an AFK-ready continuation record.

## Dispatch

- If the user asks to resume, first find current task state, prior handoff, recent diff, and relevant docs.
- If the user asks to pause or transfer, summarize only what the next agent needs to act.
- If durable project truth emerged, point to or update durable docs instead of burying it in a handoff.
- If the context is temporary, save it under docs/context/ only when a file is actually needed.

## Loop

1. Summarize the objective, current state, and exact next step.
2. List changed files, relevant commands run, and verification status.
3. Include blockers, risks, assumptions, and any user decisions.
4. Point to existing durable docs instead of duplicating them.
5. Save temporary context under docs/context/ when a file is needed.
6. Redact secrets and avoid copying noisy logs unless essential.

Keep the handoff short enough that the next agent can start immediately.

## Durability Checkpoint

If the handoff contains reusable intent, boundaries, workflow rules, or failure modes, capture or point to the durable doc before finishing. Otherwise say: No durable capture needed: handoff is temporary continuation context.
