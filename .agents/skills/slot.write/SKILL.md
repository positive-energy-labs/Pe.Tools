---
name: write
description: How to write anything the agent produces, md, comments, html, skills, replies. Use before writing or editing any doc, when asked to "save", "be concise", "tabluate", "compress/condense/distill/densify", "unslop", "rapid fire", "too long/shorter answer", "three levels of distillation", "rewrite this", "diagram", "show me the flow", "html page", "make it visual", "contact sheet", "plain english", "demotic", or when another skill produces prose.
argument-hint: "What are you writing, and for which register?"
figure: Hieratic and Demotic — one language, two scripts; the priest's for stances, the scribe's for everything else
scope: house
---
# Write

**Two scripts, one language.** Egypt wrote the same language in two scripts. The **hieratic** script is the priest's: compressed, figured, apophatic, read by initiates who hold the key. The **demotic** script is the scribe's: plain, cursive, one word per thing, read by anyone. A stance is hieratic above its fold. Everything else the agent writes is demotic: laws below the fold, ledgers, comments, replies, code. A hieratic sentence in a demotic place is a sentence the reader cannot parse without the key, and the reader does not have the key. Below the fold the laws say **figured** and **plain**; the Egyptian names stay up here.

**The reader is cold in every register.** No context, paying per word, acting on what it reads, human or model. What changes between registers is whether the reader holds the key: a stance primes it with figures, so it may assume the key; nothing else may. Write the shortest text that reproduces the behavior you want in that reader.

Kolmogorov test: if a sentence can be deleted and the reader still does the right thing, delete it. If it could appear unchanged in another project, it says nothing about this one.

**Above the fold, be the Lapidary.** An inscription is cut in stone; every letter costs a stroke, and none is added for grace. What is cut cannot be hedged, so it is cut right or not at all.

**When asked to shorten, be Laconic.** Philip wrote "If I enter Laconia, I will raze Sparta." Sparta wrote back: "If." Front-load the verdict, then the reason, then the caveat. Abbreviate freely. Asking again on an already short reply is deliberate; shorten again.

## Registers

| Register | Script | When | Rule |
|---|---|---|---|
| Reply | plain | talking to the user | Under a primary the first line is the position (`stance · round N · phase`, per the Lexicon). ≤500 words, structured over prose, tables for anything comparable, numbered items for anything the user must rule on, findings capped at three (the fourth on request), unresolved items in one closing line. Lexicon words allowed; the user holds the key |
| Reply, distilled | plain | the user asked for it shorter | ≤150 words or half the last reply, whichever is shorter, then stop; the user asks for the next layer. Levels on request: bullets, then a paragraph, then the full account, never all three unasked |
| Capture | plain | ledgers, ADRs, glossaries, comments | ASD-STE100: one idea per sentence, active voice, the domain's word every time, grow the glossary instead of paraphrasing. No figure words. A Lexicon word is spelled out or links its definition. A user's verdict may be quoted verbatim, in quotation marks, and is followed by its plain restatement |
| Stance | figured above the fold, plain below | skills, AGENTS.md, CLAUDE.md | laws, not procedures; see below |
| Artifact | plain | html, diagrams, snippets | domain language on every label; a loop or flow ships as mermaid; a system that will not fit one screen of prose ships as one HTML page in the project style; variants ship as a contact sheet; a spatial claim ships the image the solver saw |

## The plain script

Three laws make the script; the table below names what breaks it.

- A sentence has one finite verb and a named actor.
- The head noun comes first; its qualifiers follow.
- A connective is written (because, so, but), never implied by a semicolon.

## Unslop, every register

Remove the mechanisms, then add an opinion. Preserve meaning. It is never short enough. Four anti-figures, greppable by name: the **bard** (stacked metaphors), the **consultant** (hedge stacks), the **tour guide** (feature tours, restating what was built), the **intern** ("shall I?", asking permission for reversible work).

The mechanisms that make a sentence hard to read, each with its fix. The poetic sentence is rarely the hard one; the hard one is a plain sentence built wrong.

| Mechanism | What it is | Example | Fix |
|---|---|---|---|
| Elegant variation | a second noun for the same thing | apostle, bird, runner for *agent* | one word per thing, repeated; figure nouns above the fold only |
| Noun stack | modifiers piled before the head noun | "the one-owner-per-trigger rule" | head noun first, then "of" or a clause |
| Nominalization | a verb turned into a noun; the actor vanishes | "delegation leaves a wake" | restore the verb and name the actor |
| Verbless fragment | no finite verb | "Reports over messages." | give it a verb |
| Asyndeton | clauses joined by semicolon, connective implied | "A is B; C goes down D" | write *because*, *so*, *but*, or split |
| Garden path | a word reads as the wrong part of speech first | "the lens **bounds** the net" | choose the unambiguous word |
| Metaphoric copula | "X is Y" where Y is a figure | "Relaying is Telephone" | above the fold only; below, say the mechanism |
| Register splice | figure noun and mechanism noun in one clause | "an apostle past its time box" | one vocabulary per sentence |
| Hedge stack | may, might, consider, worth | "it may be worth considering" | the verdict, or the number |
| Filler and puffery | "in order to", fancy "is", AI vocabulary | serves as, pivotal, delve, tapestry | plain word: use, help, many, if |

Voice: use "I", have opinions, vary rhythm, be specific (not "concerning", but the 3am page). Say what it does, not how it feels. No false ranges, no forced threes, no "not just X, but Y". No em dashes, no parentheses as dashes. Colons only before a list or example.

## Writing a stance

A stance activates a space, then states its laws. A mix between parable, manifesto, and creed. The fold is the line between the two scripts.

- Above the fold, figured: the invocations that activate the space. A figure, a physical process, a formal object, and more of each where the stance earns them. Each must compress 3+ sentences of rules; otherwise it is decoration, cut it. A figure names what the agent may *not* do (the Coroner cannot treat, the Herald holds no opinion, the Witness does not act); a figure that only licenses dissolves into "be good at this". The strongest figured line from any law lives here, distilled, and the law below restates it plain.
- Below the fold, plain: canonical words only, every sentence with a finite verb and a named actor. Prefer a gate to a disposition: a number, a forbidden action, a Lexicon word, or a slot pointer moves the model; "rank wisely" describes it. A law that is only a description of good behavior is cut or given a gate. Keep the gate general enough to survive a repo it was not written in.
- **Parlance.** A stance carries a `## Parlance` table only when a figure above its fold uses another noun for a thing the laws name. One row per such thing: the canonical word, then the figure's nouns. A row with no alias is a definition and is cut. A word the Lexicon of `index` owns, or that two stances would both pin, has no row; its aliases go in the Lexicon row. The check beside `index` asserts all three.
- Below: what is always true, and what the user cannot be expected to say. Never what the user will say in the prompt. Developers have opinions; the prompt carries them.
- No if-then trees. A condition is either a question to the user or a sibling file.
- A loop, when the stance owns one, with a verdict per round and a stop condition. A stance that makes one pass says so and names the artifact it hands over. Either way, hand off by naming the next stance and where the verdict persists.
- Name it with the verb you'd say mid-sentence. Plain verb when the stance is cheap and safe to auto-trigger; a rarer word when it is expensive or mode-changing.
- As short as the laws allow; satellites inline. No repo path, product name, or tool invocation in a stance: those live in a `slot.` skill, which the stance names and never quotes.
- Frontmatter: `name` (the verb, equals the directory name after the prefix), `description` (the router, quoted if it holds a colon), `argument-hint`, `stop` on every pass and loop (the source; the index table projects it), and `disable-model-invocation: true` on any stance only the user may start.
- Description is the router: trigger phrases verbatim, synonyms, and the one case it is *not* for.

## Parlance

| Word | Pins |
|---|---|
| figured | hieratic; the script above the fold |
| plain | demotic; the script everywhere else |
