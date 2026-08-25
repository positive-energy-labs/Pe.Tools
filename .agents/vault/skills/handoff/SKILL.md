---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a handoff summarising the current conversation so a fresh agent can continue the work. Default to a **copy-pasteable inline handoff** in your reply; write a file at `.artifacts/handoffs/<yyyy-mm-dd>-<topic>.md` only when the payload is substantive (research results, baselines for comparison, tooling/feedback-loop issues the next agent needs). See the `docs` skill: handoffs are consumed-then-deleted, and anything durable gets promoted to a ledger, ADR, or code first.

Include a "suggested skills" section in the handoff (inline or file), naming which skills the next agent should call the Skill tool for.

Do not duplicate content already captured in other artifacts (specs, ledgers, ADRs, commits, diffs). Reference them by path instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
