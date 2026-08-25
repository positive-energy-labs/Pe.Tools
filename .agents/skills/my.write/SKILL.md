---
name: write
description: How to write anything the agent produces, md, comments, html, skills, replies. Use before writing or editing any doc, when asked to "be concise", "compress", "unslop", "rewrite this", "write it up", "diagram", "show me the flow", "html page", "make it visual", "contact sheet", or when another skill produces prose.
argument-hint: "What are you writing, and for which register?"
---
# Write

**Every doc is an agent doc.** The reader is a cold model: no context, paying per word, acting on what it reads. Write the shortest text that reproduces the behavior you want in that reader. A human reader loses nothing; they skim the same way.

Kolmogorov test: if a sentence can be deleted and the reader still does the right thing, delete it. If it could appear unchanged in another project, it says nothing about this one.

## Registers

| Register | When | Rule |
|---|---|---|
| Reply | talking to the user | ≤500 words, structured over prose, tables for anything comparable, unresolved items in one closing line |
| Capture | ledgers, ADRs, glossaries, comments | ASD-STE100: one idea per sentence, active voice, the domain's word every time, grow the glossary instead of paraphrasing |
| Stance | skills, AGENTS.md, CLAUDE.md | laws, not procedures; see below |
| Artifact | html, diagrams, snippets | domain language on every label; a loop or flow ships as mermaid; a system that will not fit one screen of prose ships as one HTML page in the project style; variants ship as a contact sheet; a spatial claim ships the image the solver saw |

## Unslop, every register

Remove the patterns, then add a voice. Preserve meaning. It is never short enough. Four anti-figures, greppable by name: the **bard** (stacked metaphors, "the waveform collapsed"), the **consultant** (hedge stacks, "it may be worth considering"), the **tour guide** (feature tours, restating what was built), the **intern** ("shall I?", asking permission for reversible work).

- Voice: use "I", have opinions, vary rhythm, be specific (not "concerning", but the 3am page). Abstract metaphor nouns only when the concept is foggy and the word will be reused (substrate → base, vector → way, ratchet → the mechanism's name).
- Say what it does, not how it feels; name the mechanism or the number.
- One idea per sentence. Active voice; name the actor. Cut adverbs, or use the stronger verb or the delta.
- Plain word: use, help, many, if. Pick one word per thing and repeat it.
- No false ranges, no forced threes, no "not just X, but Y".
- Cut filler ("in order to", "it is important to note"), fancy "is" (serves as, boasts, features), hedging stacks, trailing -ing phrases (ensuring, fostering), puffery and AI vocabulary (pivotal, testament, landscape, delve, crucial, enhance, intricate, tapestry, underscore).
- No em dashes, no parentheses as dashes. Colons only before a list or example.

## Writing a stance

A stance activates a space, then states its laws.

- Above the fold: one figure, one physical process, one formal object. Each must compress 3+ sentences of rules; otherwise it is decoration, cut it.
- Below: what is always true, and what the user cannot be expected to say. Never what the user will say in the prompt (scope, taste, target, count). Developers have opinions; the prompt carries them.
- No if-then trees. A condition is either a question to the user or a sibling file.
- One loop, with a verdict per round and a stop condition. Hand off by naming the next stance and where the verdict persists.
- Name it with the verb you'd say mid-sentence. Plain verb when the stance is cheap and safe to auto-trigger; a rarer word when it is expensive or mode-changing.
- As short as the laws allow; satellites inline. Repo paths go to the `docs` skill, so the stance stays portable.
- Frontmatter: `name` (the verb, equals the directory name after the prefix), `description` (the router, quoted if it holds a colon), `argument-hint`, and `disable-model-invocation: true` on any stance only the user may start.
- Description is the router: trigger phrases verbatim, synonyms, and the one case it is *not* for.
