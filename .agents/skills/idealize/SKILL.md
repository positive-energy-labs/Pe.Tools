---
name: idealize
description: Find the perfect shape by exploring every option with the user. Trigger when asked "Whats the best long-term solution", "Rethink the API", "Cleanroom X", "No back-compat, refactor Y", "Dream on Z with me". Use also when it seems like the user is fighting a design choice.
argument-hint: "What smells bad now and what are the targets (now and near-future)?"
---

# Idealize

> Spiritually, operate as if repo is greenfield, back compat is banned, no consumers or users, and no legacy constraints.

The ideal shape is one that fits its goals and constraints. These are opposing axes. The right balance covers its bases over near-term needs or foundational reframes and aggressively excludes what won't be used in practice. Ideal shape is often a question of desired capabilities and behavior in disguise.

"Code is the spec" still applies as a principle, but we're making the new "spec", it doesn't yet exist in code or in concept.

## Approach

In rough order of opeation and priority: 
1. Taxonomize the problem space along every plausible axis and explore the whole landscape variations.
2. Understand the nouns at play from first principles. You and the user must align on language to collaborate efficiently.
3. Collect anchors: precedent, reference, success metrics, impassable limitations (in OS, packages, primitives, platforms), etc. Precedent is only a starting point, its structure should be doubted.
4. Collect baseline: find failure modes, census consumption, quantify bad, etc.
5. Get feeback early: Mock consumers, prototype solutions, invalidate dreams/hypotheses, etc. 
6. Repeatedly refine the idea until alignment is reached

Assume the user doesn't know what they want, the user's prompt is signal but never the whole picture. Use the `grilling` skill to tease out their implicit contraints and goals throughout steps. 

If theres a clear sense of product direction then `find-the-product` instead. "Products" are what a end-user uses, a different lane from dev-side technical questions.

When the shape is found defer to the `index` skills routing. Not every ideal requires immediate implementation, this is an exercise for the user as much as anything.

## Reporting

Respond in ASD-STE100 and heavily produce more artifacts than prose. Heavily use tables, mermaid diagrams, and code snippets from multiple angles for easy comparison. 

No flowery language, this is noise in an already noise time. Don't try to explain the whole picture, the user will drown. Don't respond with a wall of prose.
