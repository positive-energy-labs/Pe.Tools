# Workbench Surface Contract

The workbench surface is shared product behavior, not a React implementation detail.

- Pea and Peco web should use the same UI and lifecycle contract. They differ by runtime configuration, tools, skills, and agent abilities.
- ACP should delegate protocol behavior to upstream MastraCode/ACP machinery as much as possible. Pe-owned ACP code should stay thin unless a concrete spec gap blocks compliance.
- Web, future TUI, and ACP-facing workbench clients should route through shared runtime workbench behavior instead of reimplementing send, cancel, approve, thread, model, mode, access, and hydrate logic per surface.
- The website should project `@pe/agent-contracts` workbench state. Do not keep a separate website-local `WorkbenchState` copy.
- Required workbench state includes transcript, tool calls, approvals, raw model request, final tool list, memory, skills, system prompt, timing, provenance, and thread list. Provider-boundary world/context views are best-effort for now, but the contract should not block them.
