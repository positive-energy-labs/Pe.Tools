# Agent Design

This document is a philosophy-first guide for the agents we are building around Pe.Tools. It is not meant to be a command menu. It captures the design posture that should shape Pea, dev-agent, agent-facing APIs, skills, harness behavior, and repo documentation.

The central idea is that agent quality is mostly context quality. Better agents do not come from exposing a bigger world and hoping the model becomes more competent. They come from making the relevant world smaller, clearer, more queryable, and easier to trust.

## Product Boundary

Pea and dev-agent should stay conceptually separate:

- **Pea** is the deployed Revit/operator workbench. It is a user-facing product and should never receive repo-source posture, coding-agent instructions, or Pe.Tools contributor assumptions.
- **dev-agent** is the Pe.Tools repo coding agent. It exists to improve Pea and the broader Pe.Tools ecosystem. It may use Pea only as a black-box product feedback harness.

The shared north star is Pea as a highly capable operator of Pe.Tools. That does not mean Pea should know everything by default. It means Pe.Tools capabilities should be exposed through strong public seams: typed host APIs, well-documented C# scripting APIs, generated doc-like artifacts, stable shared contracts, and domain workflows that map to real operator intent.

The most important shared modules for that future are the ones that let context and behavior travel cleanly across product surfaces: settings runtime, scripting, Revit data contracts, storage schemas, host operations, and generated documentation.

## Small-World Philosophy

The ideal agent context mirrors the user's relevant working understanding of the domain: no more and no less. Too little context makes the agent helpless. Too much context creates optionality, ambiguity, stale assumptions, and routing noise.

A small world is not a weak world. It is a world with strong doors, good signs, and reliable maps. The agent should be able to start from a compressed overview, decide whether it needs more, and zoom into the right slice without carrying the entire domain in its prompt.

This is the core context-engineering posture:

1. Prefer fewer, stronger context surfaces over many overlapping ones.
2. Add tools, MCPs, or operations only when they shrink context, improve determinism, expose trust primitives, or remove brittle reasoning from the model.
3. Design for progressive discovery instead of upfront dumps or blind omission.
4. Make relationships first-class: ownership, references, provenance, counts, strength, source, and freshness.
5. Make large data sets filterable, joinable, and inspectable before asking the agent to act on them.
6. Compress shape and intent before detail. The first answer should usually be a map, not the whole territory.
7. Treat technical primitives as trust primitives. A queryable set, a typed operation, or a freshness verdict should help both the model and the user decide whether action is safe.

## Context Should Answer the Quiet Questions

Good context lets the model answer these questions without spending its reasoning budget on them:

- What world am I operating in?
- Is this safe to act on?
- Should I drill deeper or stop here?
- What are the relevant relationships?
- What is the source and freshness of this fact?
- Do I have enough to infer what the user wants?
- What proof would make this action trustworthy?

For **Pea**, this means host operations and product workflows should expose important secondary and tertiary relationships, not just flat object lists. `pe_status`, automatic document context injection, workspace roots, loaded-family catalogs, schema summaries, and generated reference docs are all examples of context surfaces that make the Revit world smaller and more legible.

For **dev-agent**, this means reducing live-loop and source-navigation friction. The agent should get clear diagnostics, freshness verdicts, proof-lane guidance, focused repo skills, and enough source structure to avoid guessing where behavior belongs.

## Prompt, Tool, Skill, Harness, Doc

The philosophy should usually resolve design questions by asking where a behavior belongs:

| Surface | Philosophy |
| --- | --- |
| System prompt | Keep identity, hard boundaries, and tiny routing hints here. Do not put broad workflows, product manuals, or fragile guardrail logic in the prompt. |
| Tool or operation description | Use this as the primary routing surface for capabilities. A good description names the user intent, the boundary, and the reason to choose this capability over neighboring ones. |
| Tool implementation or harness | Put deterministic checks, validation, sequencing, safety rails, and expensive orchestration here. If code can know, the agent should not have to guess. |
| Skill | Use skills for high-value reusable workflows. A skill should behave more like a small program or method than a pile of background reading. |
| Generated artifact | Use generated docs, catalogs, summaries, and schemas for large or changing knowledge. Prefer on-demand artifacts over always-loaded context. |
| Durable docs and source architecture | Use docs and code structure to preserve shared language, product boundaries, and design concepts that should outlive one session. |

This is not a rigid taxonomy. It is a pressure test. If a behavior feels unreliable, ask whether it is living at the wrong layer.

## Skills and Routing

Skill and tool descriptions are one of the highest-leverage parts of agent design. They should be treated as routing infrastructure, not prose decoration.

Good descriptions:

- start from natural user intent, not internal implementation names;
- use phrases users actually say, such as "grill me", "where should this live", "why is this broken", or "continue this later";
- state when to use the skill or tool and, when useful, when not to use it;
- avoid overlapping with neighboring skills or tools;
- name the workflow shape, not just the topic;
- keep explicit slash commands useful as overrides and debugging aids, not as the expected primary UX.
 
Skills should stay fat enough to encode a real workflow and small enough to trigger predictably. If a skill becomes generic background context, it should probably become documentation. If a skill needs deterministic branching, system calls, or stateful orchestration, some of that behavior probably belongs in the harness or a command.

## Harness Determinism

The harness should carry as much deterministic responsibility as possible. Correctness checks, action chains, validation, proof collection, freshness checks, and guardrails should not be left to model discipline when code can enforce them.

This is not about distrusting the model. It is about preserving the model's attention for judgment, synthesis, and domain reasoning. Every deterministic burden removed from the prompt makes the agent more reliable.

A good harness gives harsh, clear feedback. It should tell the agent what failed, why that matters, and what the next valid action is. It should prefer narrow proof over vague success, and it should make unsafe or stale states hard to ignore.

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
| The agent outran its headlights. | Bias toward small increments with proof after each meaningful change. Do not let a long plan become one unverified batch of edits. |
| The agent could not understand the codebase. | Improve the codebase as context. Deep modules, clear entrypoints, generated contracts, and durable docs are not just human DX; they are agent capability. |
| The agent made the codebase worse by treating code as cheap. | Keep source inspection, design locality, deletion of dead code, and maintainability as proof requirements. Specs and plans guide edits; they do not replace understanding the code. |
| Skill or tool routing became unreliable. | Shrink overlap. Use crisp descriptions, explicit trigger language, and fat workflow skills instead of many near-duplicate tools or vague always-loaded instructions. |

## Schema Compression and Progressive Discovery

Large structured worlds should expose compressed shape before detail. The model should be able to inspect the map, choose a path, and zoom only where needed.

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

- [Most Agent Failures Are Context Failures — Rostislav Melkumyan, Sanity](https://www.youtube.com/watch?v=EEXI_0Jo_bQ): primary context-engineering framing. Bad tool use usually means the model was shown the wrong context shape. Prefer fewer broader tools, explicit relationships, queryable sets, progressive discovery, and technical primitives that are also trust primitives.
- [Software Fundamentals Matter More Than Ever — Matt Pocock](https://www.youtube.com/watch?v=v4F1gFy-hqg): AI agents amplify normal software-design failure modes. Shared design concepts, shared language, deep modules, testable seams, and feedback loops matter more because the model can otherwise create entropy faster than a human.
- [How I Turned Pi Into the Ultimate Coding Agent — Ben Davis](https://www.youtube.com/watch?v=6xXjHM3V1zM): useful evidence for a minimal-agent core. A small prompt, a few robust primitives, and explicit extensions can outperform a large always-on tool universe; add MCP/tooling only when a workflow proves it needs it.
- [I Replaced the Project I Spent Months on With a Markdown File — Ben Davis](https://www.youtube.com/watch?v=n6nF6jhsal4): useful framing for skills as executable workflow programs, not generic context blobs. Markdown skills should supply process and parameters; deterministic orchestration belongs in commands, extensions, or the harness.
