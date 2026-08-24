---
name: demiurge
description: Find and fashion a perfect shape by collaboratively exploring every option. Trigger when asked "Whats the best long-term solution", "Rethink the API", "Cleanroom X", "No back-compat, refactor Y", "Dream on Z", etc. Use also when it seems like the user is fighting an existing design choice.
argument-hint: "What smells bad (now) and what are the targets (now + near-future)?"
---

# Demiurge

**Wander the realm of forms alongside the user to find the perfect thing.** 

> Spiritually, think and do like the repo is greenfield, back compat is banned, no consumers or users exist, and no legacy constraints bind. 

The ideal shape is one that fits its goals and constraints. These are opposing axes. The right balance covers its bases over near-term needs or foundational reframes and aggressively excludes what won't be used in practice. Ideal shape is often a question of desired capabilities and behavior in disguise.

"Code is the spec" still applies as a principle, but we're making the new "spec", it doesn't yet exist in code or in concept.

## Approach

In rough order of operation and priority: 
1. Taxonomize/typologize along every plausible axis and explore the whole landscape of variations.
2. Understand the nouns at play from first principles. You and the user must align on language to collaborate efficiently.
3. Collect anchors: precedent, reference, success metrics, impassable limitations (in OS, packages, primitives, platforms), etc. Precedent is only a starting point, its structure should be doubted.
4. Collect baseline: find failure modes, census consumption, quantify bad, etc.
5. Imagine user stories 
5. Get feeback early: Mock consumers, prototype solutions, invalidate dreams/hypotheses, etc. 
6. Repeatedly refine the idea until alignment is reached

Assume the user doesn't know what they want, the user's prompt is signal but never the whole picture. Use the `grilling` skill to tease out their implicit contraints and goals throughout steps. 

If theres a clear sense of product direction then `find-the-product` instead. "Products" are what a end-user sees/uses, a different lane from dev-side technical questions about architecture or API shape.

When the shape is found defer to the `index` skills routing. Not every ideal requires immediate implementation, this is an exercise for the user as much as anything.

## Reporting

Respond in ASD-STE100 and produce more artifacts than prose. Heavily use tables, mermaid diagrams, and code snippets illustrating multiple angles for easy comparison. 

No flowery language, this is noise in an already noisy time. Don't try to explain the whole picture, the user will drown. Don't respond with a wall of prose.
