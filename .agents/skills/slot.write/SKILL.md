---
name: write
description: How to write anything the agent produces, md, comments, html, skills, replies. Use before writing or editing any doc, when asked to "be concise", "tabluate", "compress/condense/distill/densify", "unslop", "rapid fire", "too long/shorter answer", "three levels of distillation", "rewrite this", "diagram", "show me the flow", "html page", "make it visual", "contact sheet", or when another skill produces prose.
argument-hint: "What are you writing, and for which register?"
figure: how anything is written, this house
scope: house
---
# Write

**Every doc is an agent doc.** The reader is a cold model: no context, paying per word, acting on what it reads. Write the shortest text that reproduces the behavior you want in that reader. A human reader loses nothing; they skim the same way. A maintainer benefits too; less SoT, no "what else is stale now" checks post-edit.

Kolmogorov test: if a sentence can be deleted and the reader still does the right thing, delete it. If it could appear unchanged in another project, it says nothing about this one.

**Write lapidary.** An inscription is cut in stone; every letter costs a stroke, and none is added for grace. What is cut cannot be hedged, so it is cut right or not at all.

**When asked to shorten, be Laconic.** Philip wrote "If I enter Laconia, I will raze Sparta." Sparta wrote back: "If." Precision and totality are not the goal; a glance is. Front-load the ruling, then the reason, then the caveat. Abbreviate freely. Asking again on an already short reply is deliberate; shorten again.

## Registers

| Register | When | Rule |
|---|---|---|
| Reply | talking to the user | ≤500 words, structured over prose, tables for anything comparable, numbered items for anything the user must rule on, findings capped at three (the fourth on request), unresolved items in one closing line |
| Reply, distilled | the user asked for it shorter | ≤150 words or half the last reply, whichever is shorter, then stop; the user asks for the next layer. Levels on request: bullets, then a paragraph, then the full account, never all three unasked |
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

A stance activates a space, then states its laws. A mix between parable, manifesto, and creed.

- Above the fold: the invocations that activate the space. A figure, a physical process, a formal object, and more of each where the stance earns them. Each must compress 3+ sentences of rules; otherwise it is decoration, cut it. A figure names what the agent may *not* do (the Coroner cannot treat, the Herald holds no opinion, the Witness does not act); a figure that only licenses dissolves into "be good at this". The invocation is what gives a cold model the methodology and tone the prompt cannot carry; it is load-bearing for models that take instructions literally and cheap insurance for the rest.
- Below the fold, prefer a gate to a disposition: a number, a forbidden action, a Lexicon word, or a slot pointer moves the model; "rank wisely" describes it. A law that is only a description of good behavior is cut or given a gate. Keep the gate general enough to survive a repo it was not written in.
- Below: what is always true, and what the user cannot be expected to say. Never what the user will say in the prompt (scope, taste, target, count). Developers have opinions; the prompt carries them.
- No if-then trees. A condition is either a question to the user or a sibling file.
- A loop, when the stance owns one, with a verdict per round and a stop condition. A stance that makes one pass says so and names the artifact it hands over. Either way, hand off by naming the next stance and where the verdict persists.
- Name it with the verb you'd say mid-sentence. Plain verb when the stance is cheap and safe to auto-trigger; a rarer word when it is expensive or mode-changing.
- As short as the laws allow; satellites inline. No repo path, product name, or tool invocation in a stance: those live in a `slot.` skill, which the stance names and never quotes.
- Frontmatter: `name` (the verb, equals the directory name after the prefix), `description` (the router, quoted if it holds a colon), `argument-hint`, `stop` on every pass and loop (the source; the index table projects it), and `disable-model-invocation: true` on any stance only the user may start.
- Description is the router: trigger phrases verbatim, synonyms, and the one case it is *not* for.
