# Agent Design

This document is the steering philosophy for the agents we are building around Pe.Tools. It is philosophy-first, but it is not neutral. Treat it as an intentional overcorrection toward the agent-design posture we want humans, agents, tools, and product surfaces to internalize.

The industry is still forming this philosophy. LLMs will not reliably infer it from general training, and humans will not consistently apply it without repetition. Therefore this document should use stronger language than a mature domain normally needs. Its job is to steer decisions before the defaults of "more context", "more tools", "bigger prompts", and "let the model figure it out" creep back in.

The central claim is simple: agent quality is mostly context quality. Better agents do not come from exposing a bigger world and hoping the model becomes more competent. Better agents come from making the relevant world smaller, clearer, more queryable, and easier to trust.

## Small-World Philosophy

The ideal agent context mirrors the user's relevant working understanding of the domain: no more and no less. Too little context makes the agent helpless. Too much context creates optionality, ambiguity, stale assumptions, routing noise, and false confidence.

A small world is not a weak world. It is a world with strong doors, clear signs, reliable maps, and bounded paths. The agent should start from a compressed overview, decide whether it needs more, and zoom into the right slice without carrying the entire domain in its prompt.

This is the core context-engineering posture:

1. Prefer fewer, stronger context surfaces over many overlapping ones.
2. Resist adding tools, MCPs, operations, always-loaded docs, or prompt text by default.
3. Add a capability only when it shrinks context, improves determinism, exposes trust primitives, or removes brittle reasoning from the model.
4. Design for progressive discovery instead of upfront dumps or blind omission.
5. Make relationships first-class: ownership, references, provenance, counts, strength, source, and freshness.
6. Make large data sets filterable, joinable, and inspectable before asking the agent to act on them.
7. Compress shape and intent before detail. The first answer should usually be a map, not the whole territory.
8. Treat technical primitives as trust primitives. A queryable set, a typed operation, or a freshness verdict should help both the model and the user decide whether action is safe.

When in doubt, shrink the world. If the agent still needs more, give it a better door into the world rather than dumping the world into the agent.

## Context Should Answer the Quiet Questions

Good context lets the model answer these questions without spending its reasoning budget on them:

- What world am I operating in?
- Is this safe to act on?
- Should I drill deeper or stop here?
- What are the relevant relationships?
- What is the source and freshness of this fact?
- Do I have enough to infer what the user wants?
- What proof would make this action trustworthy?

If a tool, operation, skill, or prompt leaves these questions implicit, it is incomplete. Do not compensate by asking the model to be more careful. Fix the context surface.

For **Pea**, host operations and product workflows must expose important secondary and tertiary relationships, not just flat object lists. `pe_status`, automatic document context injection, workspace roots, loaded-family catalogs, schema summaries, and generated reference docs are examples of context surfaces that make the Revit world smaller and more legible.

For **dev-agent**, the priority is removing live-loop and source-navigation friction. The agent should receive clear diagnostics, freshness verdicts, proof-lane guidance, focused repo skills, and enough source structure to avoid guessing where behavior belongs.

## Control Loop and Judgment Loop

Agent systems run two coupled loops:

- **Control loop**: harness-owned state, permissions, modes, tool availability, exact tool invocation rules, message delivery, task tracking, proof and freshness signals, validation, and orchestration.
- **Judgment loop**: model-owned interpretation, prioritization, planning, action selection, tradeoff handling, synthesis, and communication.

The system prompt is allowed to be specific about the control loop. It must be specific when the model needs exact registered names, argument rules, sequencing rules, or state protocols to operate safely. Mastra Code's `tool-guidance.ts` is the right shape: it names available tools, explains exact invocation constraints, and gives hard protocol rules for task tracking, file edits, shell execution, planning, subagents, and user questions.

Do not confuse control-loop specificity with dumping the action universe into the prompt. The system prompt should not enumerate every domain capability or teach the model every product workflow. Put judgment and action detail in tool descriptions, operation catalogs, skills, generated artifacts, and docs that the model can discover when relevant.

Examples:

- `task_write`, `task_update`, `task_complete`, and `task_check` belong in system/tool guidance because they are harness state-management protocol.
- `view`, `search_content`, `find_files`, `execute_command`, and edit tools belong there because they define the basic control surface for source work.
- `host_operation_search` may belong there as a generic discovery door into a generated operation universe.
- A specific operation like `get_revit_schedules` should not live in the system prompt (nor anywhere probably). Its description belongs beside the operation or in a generated catalog, where routing can stay local and update with the capability.

A prompt is not bad because it contains tool specifics. It is bad when it spends scarce always-loaded context on judgment/action detail that should be discoverable, typed, or harness-owned.

## Prompt, Tool, Skill, Harness, Doc

Most agent-design problems are placement problems. Before improving a prompt, adding a tool, or writing another instruction, decide where the behavior belongs:

| Surface | Steering rule |
| --- | --- |
| System prompt | Keep identity, hard boundaries, mode/environment facts, exact control-loop tool protocol, and tiny routing hints here. Be specific about registered tool names and harness rules when the model must use them correctly. Do not put product capability inventories, broad workflows, domain manuals, or fragile judgment/action guidance in the prompt. |
| Tool or operation description | Treat this as the primary routing surface for capabilities. A good description names the user intent, the boundary, and why to choose this capability over neighboring ones. Specific domain actions should route from here, not from the system prompt. |
| Tool implementation or harness | Put deterministic checks, validation, sequencing, safety rails, freshness checks, and expensive orchestration here. If code can know, the agent should not have to guess. |
| Skill | Use skills for high-value reusable workflows. A skill should behave more like a small program or method than a background-reading packet. Keep procedural skill detail in the skill, not in always-loaded prompt text. |
| Generated artifact | Use generated docs, catalogs, summaries, and schemas for large or changing knowledge. Prefer on-demand artifacts over always-loaded context. |
| Durable docs and source architecture | Use docs and code structure to preserve shared language, product boundaries, and design concepts that should outlive one session. |

This taxonomy is a pressure test, not bureaucracy. If a behavior feels unreliable, assume it is living at the wrong layer until proven otherwise.

Host operation metadata is a compact routing and callability surface, not a workflow planner. Its strongest signals are key taxonomy, safety gates, request affordances, generated request/response shapes, terse search terms, and sparse practical related operations. Public discovery output should not repeat taxonomy already carried by the key (`domain`, `family`, `revitLayer`, `domainNoun`) or derived intent; keep those internal for scoring/filtering when useful. Repeated preflight rules belong in tool descriptions, deterministic failure handling, or harness validation, while operation-local prose stays in capped `callGuidance`. Do not add overlapping prose fields to teach the model sequences; put deterministic sequencing in the harness, repeated workflows in skills, and domain detail in operation results or generated zoom-in artifacts.

## Skills and Routing

Skill and tool descriptions are routing infrastructure. They are not prose decoration.

Good descriptions must:

- start from natural user intent, not internal implementation names;
- use phrases users actually say, such as "grill me", "where should this live", "why is this broken", or "continue this later";
- state when to use the skill or tool and, when useful, when not to use it;
- avoid overlap with neighboring skills or tools;
- name the workflow shape, not just the topic;
- keep explicit slash commands useful as overrides and debugging aids, not as the expected primary UX.

Skills should be fat enough to encode a real workflow and narrow enough to trigger predictably. A thin skill that only adds generic context is probably documentation. A giant skill that wants deterministic branching, system calls, stateful orchestration, or validation is probably missing harness or command support.

The system prompt may name skill routing rules at a high level, but it should not preload skill procedures. Judgment/action guidance belongs in the skill or tool surface that is selected for the task, not in the always-loaded control prompt.

The default failure mode is overlap. When routing gets unreliable, do not add more prompt explanation first. Shrink overlap, sharpen descriptions, and move deterministic behavior out of the model.

## Harness Determinism

The control loop must carry as much deterministic responsibility as possible. Correctness checks, action chains, validation, proof collection, freshness checks, and guardrails should not be left to model discipline when code can enforce them.

This is not about distrusting the judgment loop. It is about preserving the model's attention for judgment, synthesis, and domain reasoning. Every deterministic burden removed from the model makes the agent more reliable.

A good harness gives harsh, clear feedback. It tells the agent what failed, why that matters, and what the next valid action is. It prefers narrow proof over vague success, and it makes unsafe or stale states hard to ignore.

Do not ask the model to remember a safety rule if the harness can enforce it. Do not ask the model to infer freshness if the harness can report it. Do not ask the model to sequence a brittle workflow if the harness can own the sequence.

## Code Architecture Is Agent Context

A codebase is part of the prompt whether or not it is loaded into the context window. Agents navigate architecture through names, seams, tests, docs, generated contracts, and failure output.

This makes normal software fundamentals more important, not less:

- Prefer deep modules with simple public interfaces over shallow modules scattered across many files.
- Prefer stable shared models and generated contracts over similar-but-different shapes.
- Prefer clear package boundaries and public seams over clever local shortcuts.
- Prefer tests, types, and executable feedback loops over prose-only confidence.
- Delete stale code and stale docs; old context is actively harmful to agents.

Bad code is expensive because it makes every future agent interaction worse. Good code compounds because it gives the model a smaller and more trustworthy world.

## Failure Modes to Design Against

Matt Pocock's AI coding failure modes map cleanly to agent-design responsibilities:

| Failure mode | Agent-design response |
| --- | --- |
| The agent did not do what the user wanted. | Treat the missing artifact as shared understanding, not a better prompt. Trigger steering or grilling workflows before implementation when intent, boundaries, or tradeoffs are still implicit. |
| The agent built the intended thing, but it did not work. | Give the agent fast feedback loops and make the harness enforce them. Static types, compile checks, tests, logs, host diagnostics, and browser/Revit/runtime probes are the agent's speed limit. |
| The agent outran its headlights. | Force small increments with proof after each meaningful change. Do not allow a long plan to become one unverified batch of edits. |
| The agent could not understand the codebase. | Improve the codebase as context. Deep modules, clear entrypoints, generated contracts, and durable docs are not just human DX; they are agent capability. |
| The agent made the codebase worse by treating code as cheap. | Keep source inspection, design locality, deletion of dead code, and maintainability as proof requirements. Specs and plans guide edits; they do not replace understanding the code. |
| Skill or tool routing became unreliable. | Shrink overlap. Use crisp descriptions, explicit trigger language, and fat workflow skills instead of many near-duplicate tools or vague always-loaded instructions. |

## Schema Compression and Progressive Discovery

Large structured worlds must expose compressed shape before detail. The model should inspect the map, choose a path, and zoom only where needed.

A good compressed view includes:

- entity or schema name;
- human title field or identity field;
- count and scope;
- important fields with coarse types;
- references out and references in;
- provenance and freshness when relevant;
- available zoom/filter/join paths.

Example shape:

```text
// TOON or TOON-like high-level views
- blogPost (title: title, depth: 3, count: 843)
  - fields: title<string>, slug<slug>, body<array>, author<reference>
  - references: author -> author x843
- author (title: name, depth: 2, count: 127)
  - fields: name<string>, bio<text>, photo<image>
  - referenced by: blogPost x843, podcast x64
- person (title: name, depth: 2, count: 12)
  - fields: name<string>, role<string>, company<string>
  - referenced by: event x8

schemaZoom({ type: "company", path: "contacts[].person.profile", depth: 2 })
=> profile<object> {
  email<string>,
  title<string>,
  photo<image>,
  timezone<string>
}
```

The exact format matters less than the posture: summarize first, preserve relationships, make zoom explicit, and keep the output small enough that the agent can reason over it.

## Resources and Inspiration

- [Prompting Tech Debt](https://www.promptick.ai/blog/prompt-debt-managing-legacy-ai-logic): skills, mcps, commands, AGENTS.md's, etc. are all prompts, whether they were written by you or not.
- [Most Agent Failures Are Context Failures — Rostislav Melkumyan, Sanity](https://www.youtube.com/watch?v=EEXI_0Jo_bQ): primary context-engineering framing. Bad tool use usually means the model was shown the wrong context shape. Prefer fewer broader tools, explicit relationships, queryable sets, progressive discovery, and technical primitives that are also trust primitives.
- [Software Fundamentals Matter More Than Ever — Matt Pocock](https://www.youtube.com/watch?v=v4F1gFy-hqg): AI agents amplify normal software-design failure modes. Shared design concepts, shared language, deep modules, testable seams, and feedback loops matter more because the model can otherwise create entropy faster than a human.
- [How I Turned Pi Into the Ultimate Coding Agent — Ben Davis](https://www.youtube.com/watch?v=6xXjHM3V1zM): useful evidence for a minimal-agent core. A small prompt, a few robust primitives, and explicit extensions can outperform a large always-on tool universe; add MCP/tooling only when a workflow proves it needs it.
- [I Replaced the Project I Spent Months on With a Markdown File — Ben Davis](https://www.youtube.com/watch?v=n6nF6jhsal4): useful framing for skills as executable workflow programs, not generic context blobs. Markdown skills should supply process and parameters; deterministic orchestration belongs in commands, extensions, or the harness.
