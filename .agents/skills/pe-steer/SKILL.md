---
name: pe-steer
description: Clarify Pe.Tools intent before implementation by grilling scope, vocabulary, product boundaries, and durable capture. Use when the user says grill me, think this through, I don't know, what should this be, I don't like this, or when a request is vague, strategic, overloaded, philosophical, likely to sprawl, or likely to create reusable project truth.
metadata:
  goal: true
---

# pe-steer

Use when the problem is misalignment: unclear outcome, overloaded language, competing scopes, product philosophy, or a conversation that should leave durable intent behind.

pe-steer is the strongest docs-first skill. It should turn vague intent into shared language, an implementation boundary, or a clear stop.

## Dispatch

- If the user says "grill me", interrogate one unresolved branch at a time until the next material decision is clear.
- If the user is vague, state the likely outcome and ask the smallest clarifying question only when the answer changes the work.
- If the user says "I don't like this", review the current work against the stated intent before editing.
- If the request uses overloaded Pe.Tools language, resolve the term against existing docs before inventing new vocabulary.
- If the request implies durable philosophy, boundaries, proof rules, or repeated failure modes, capture that before implementation.
- If the request is already concrete and non-durable, route to the narrow skill or implement directly.

## Context Resolution

Use Pe.Tools docs as the resolver substrate:

1. Nearest AGENTS.md for durable agent behavior, cautions, and shared language.
2. Relevant \_GOALS.md for intent, north star, and non-goals.
3. Relevant \_DEV.md for conceptual model and architecture shape.
4. docs/features/<feature>/ when a capability spans packages.
5. Generated contracts, schemas, host-operation docs, and source when they are current truth.
6. If truth is missing, treat that as signal and capture it in the nearest proper Pe doc.

Do not introduce CONTEXT.md, CONTEXT-MAP.md, or ADR conventions unless an explicit future design pass replaces the Pe-native taxonomy.

## Loop

1. Name the likely outcome and smallest useful scope.
2. Resolve existing vocabulary and context before coining new terms.
3. Walk the decision tree one branch at a time. Do not ask broad preference questions when code/docs can answer them.
4. State the recommendation with tradeoffs.
5. Ask only big intent questions or questions that materially change scope, architecture, or proof.
6. End with a concrete next action, a routed skill, or a repo-local capture summary.

## Durability Checkpoint

Before implementation, decide whether steering resolved durable reusable knowledge.

Capture when the session resolved:

- shared language or renamed concepts
- product/workflow boundaries
- repeated failure modes
- north-star intent or non-goals
- architecture rules or public-seam guidance
- verification/proof-lane rules

If capture is needed:

- In Build/default mode, update the nearest durable doc first, then implement.
- In Plan/read-only mode, make the doc update the first step of the submitted plan and do not pretend capture happened.

If no doc update is needed, say: No durable capture needed: <reason>.

Prefer concise shared language over long transcripts. Do not create MEMORY.md; recurring memory belongs in AGENTS.md.
