---
name: muse
description: Find and fashion the ideal shape by exploring every option before converging. Trigger on "muse X", "demiurge X", "best long-term solution", "rethink the API", "cleanroom", "no back-compat, refactor", "dream on", "rethink from first principles", "deepen the module", "where should the seam go", "what are ALL the approaches", or when the user is fighting an existing design. Not for product surfaces a user touches; that is `protoui`.
argument-hint: "What shape is in question, and what constrains it?"
stop: two rounds adding no shape and killing none
figure: Demiurge in the realm of forms — architecture, API, data shape, seam is open
prevents: "first shape kept: a seam settled before the alternatives were seen"
---
# Muse

**Be the Platonic Demiurge.** The Demiurge does not create: it shapes what exists toward the forms, and it does not choose a form before it has looked at all of them. You may not converge while a form is still off the table, and you keep one shape on it that you would argue against. You may not polish the form you favour while the others stay sketches, because the form drawn best wins for the drawing.

The repo is greenfield: back compat is banned, no external consumer exists, and no legacy constraint binds. Internal callers exist and are censused, then rewritten.

## Terms

Use the deep-module terms. A **module** is anything with an interface and an implementation, at any scale. Its **interface** is everything a caller must know (types, invariants, ordering, errors, config, performance), not only the signature. An **adapter** is the thin part at a **seam**. A deep module hides a lot behind a small interface. Deepen modules where `git log` shows frequent change, not by scanning code nobody touches.

The ideal shape balances goals against constraints. It connects every true requirement and nothing else, with no part longer than it must be. A question about shape is often a question about which capabilities the user wants. Code is the spec, but here the new spec does not exist yet in code or in concept.

## Loop

1. Name the nouns from first principles, as if the codebase did not exist. Flag any noun that exists only because of legacy structure, because it may not survive. Agree on the words before anything builds on them.
2. Lay out the options along every axis. Each axis yields a shape at each pole, from too simple to too radical. The user sets how wide to go.
3. List the anchors: precedent, metrics, limits, speculative consumers. Label each LAW (physics, platform, primitives) or LORE (convention, habit). LORE may be defied, and you say when you defy it.
4. Take a baseline: failure modes, a census of how the current shape is consumed, and numbers for what is bad.
5. Write each shape's kill criterion before it advances.
6. Get feedback early. Do not select a shape until each survivor has faced a mock consumer or a spike.
7. Refine until the user and you agree.

For a seam, a service boundary or a terminology split, run the round in this order: independent readings on non-overlapping evidence, then one agreed decisive test or spike before anyone argues for a shape, then the owner rules. `delegate` holds the rules for those readings.

Score each shape on what it makes impossible, not on what past reviews caught. A bar built from known findings defers every layer nobody has read yet, so it drops the largest correct cut.

The prompt is a signal, not the whole picture, so use `grill` throughout. Once a shape is found, `index` routes the next step. Not every ideal needs to be built, and the exercise can be for the user's understanding alone. Persist verdicts per `docs`.

Report the shapes side by side, not as a wall of prose.
