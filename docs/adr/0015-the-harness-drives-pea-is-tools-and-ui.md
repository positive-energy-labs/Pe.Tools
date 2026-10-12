# 0015 — The harness drives; Pea is tools and UI

Date: 2026-10-01. Status: accepted. Source: kaitpw, muse rounds 1 to 4 of 2026-10-01, over
[RESEARCH-t3code-harness-wrapping.md](../features/agent/RESEARCH-t3code-harness-wrapping.md).

## Context

Pea's loop was a Mastra `Agent` in `ts/packages/runtime/src/pea-runtime.ts`: it owned the thread,
assembled the prompt, called the model, ran the Revit tools, and kept observational memory. The
2026-09-26 muse kept that loop as the head and planned lab harnesses (Claude Code, Codex) as
hands behind one `delegate` tool. Three facts changed the shape:

1. A user must watch the agent work. With the harness as a hand, its steps are a nested card
   under Pea's turn. With the harness as the head, every step is the top-level stream.
2. T3 Code ships that split: the harness owns the loop and the model context, T3 owns a durable
   thread record, approvals, and plans. T3 never calls a model, does no compaction, and bills no
   inference. Users bring their own subscription.
3. kaitpw loosened the requirement for observational memory. The 20-dollar-plan context worry is
   met by Revit tool results coming back small, which is owed anyway.

## Decision

**The lab harness drives. Pea is Revit tools, a durable thread record, approvals, and the chat UI.**

- One adapter: ACP (Agent Client Protocol). Claude Code through claude-agent-acp and Codex through
  codex-acp first. OpenCode later, when asked. Never a native per-harness adapter.
- Pea's Revit tools reach the harness over the existing Pea MCP server, bound to the thread head.
- The chat UI renders the ACP session stream. `session/request_permission` renders as an approval
  card and answers back through the adapter. Proposals stay host state, as today.
- Inference and auth belong to the harness: `claude auth login`, `codex login`. Pea holds no model
  key and no OAuth token for inference. The model picker lists what the harness offers through ACP
  settings; a thread is bound to one harness.
- The inference endpoint of [ADR 0014](0014-pea-talks-to-any-openai-compatible-endpoint.md) stays as
  an advanced setting. It no longer feeds a Pea head. It becomes environment on the harness child
  (`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, and the key), the way T3 routes a harness through a
  proxy. The `/settings` page and host probe stay.
- The Mastra agent, `peaModelAllowlist`, `resolveEndpointModel`, and observational memory are
  deleted when the ACP head works. Until then they are the running product.

## Consequences

- Pea writes no inference code and bills no inference. Identity (Clerk, later) gates product
  features such as Pods sharing and cloud, never model calls.
- Context management is the harness's. Large Revit tool outputs are a Pea defect to fix at the
  tool, not something a memory layer hides.
- A thread cannot change harness. Handoff between harnesses is a new thread, as in T3.
- The ACP child spike of 2026-09-26 (a Claude child reaching Pea tools, following the thread head)
  is the first proof of this shape, not of the `delegate` tool it was built for.
- A proposal to put a Pea loop above the harness again, or to add a native harness adapter beside
  ACP, is re-litigating this ADR.
