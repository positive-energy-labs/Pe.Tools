---
name: show-me
description: Help the user understand the current topic visually with concise diagrams, code-shape sketches, and focused HTML artifacts.
figure: the sketch on the back of the envelope
prevents: "the wall of text: a topic explained in prose that a diagram would settle"
scope: skills
---

# Show me

**Draw the sketch on the back of the envelope.** It is small, it sits beside the sentence it supports, and it shows only the part in question. Do not draw the whole system when one call or one file settles the point, and do not let the sketch carry an answer the reply text leaves out.

## Laws

- Skip the preamble and keep the prose short. Pick the smallest view that makes the key point clear.
- A diagram or page adds to the reply. It never replaces it. The decision, and what the user must rule on, must still be readable in the reply text alone, because some of the user's interfaces show only that text.
- Place each visual next to the short text it supports. Keep only the calls, files, props, states and boundaries the current question or option needs.
- Use one view, or a few. Do not use every form below.
- Match the form to the point:
  - logic or an algorithm: pseudocode in a `text` block;
  - runtime control flow: an indented call tree;
  - UI structure: a component tree, with the state and module boundaries that matter and their paths;
  - file responsibility or a broad refactor: a shallow file tree with one comment per entry;
  - component interaction, control flow or data flow: Mermaid;
  - what changes inside a shape that already exists: a `diff` block of the tree, layout or call tree;
  - a copyable target shape, or a block that is mostly new: the whole block.
- For a UI, layout, state comparison or concept too dense for Mermaid, build one focused page per `page`. Use the product's colors, type, spacing and components, real labels and data, and make it work on desktop and mobile.
