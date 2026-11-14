---
name: reflect
description: "Maintain or port the skill set itself: write or edit a stance, change the taxonomy, set up in a new repo. Trigger on \"reflect\", \"write a skill\", \"edit this skill\", \"new stance\", \"port the skills\", \"install the skillset\". Not for using a skill on real work; that is `index`."
argument-hint: "What is being written, edited, or ported?"
figure: Theseus' ship and the Ulysses contract — the set refits itself, and binds its own cold reader
prevents: "set drift: a skill edited by feel, never run cold"
scope: skills
---
# Reflect

**Refit the ship of Theseus.** No plank is kept for being original and none is added for grace, and a cheap refit raises the bar: you may not patch around a rotten plank.

**Every skill edit is a Ulysses contract.** The sailor at the mast may not cut his own ropes while the sirens sing, so a law is never loosened by the agent it binds, in the task it binds. The hand that tied a rope may not grade it.

## Kinds

Five kinds. The directory prefix carries the kind, so a listing shows the set.

- **root** frames the set itself. `index` routes and is read at every session start. `reflect` maintains the set and is read only when the set changes. A root never does the work.
- **loop** owns the route, runs rounds, and names a stop. A loop may run inside another loop's round.
- **pass** owns the route, makes one pass, and hands over its artifact.
- **lens** stacks on the owning loop or pass. It changes what is allowed, what counts as evidence, and what the work costs. Invoked alone, it owns the route. A lens that limits the diff applies to the owner's whole diff, not to each edit. Where the lens and the owner cannot both hold, the lens yields and the reply says so.
- **slot** holds reference material. It is always available, never a route, and the only place repo-shaped content may live. `scope: repo` marks facts that are rewritten per repo. `scope: skills` marks policy that travels with the set. A repo that fills no slots still runs every stance. A stance that always needs a repo fact inlines it under a heading marked `[scope: repo]`, which is rewritten in a port like a slot.

Ordinary building is not a stance: it is the owner's own work under whatever lenses are stacked. A new skill takes the kind that matches how it is invoked (always read, routed in rounds, one pass, stacked, or looked up), not what it is about.

## Tenets

- A law is a reason before it is a rule. A prescription cannot cover every case, and a reader who holds the reason infers the intent where no case was written. Where a reason and a prescription say the same thing, cut the prescription.
- A prescription with many edges (a list of cases, an exception to an exception, a number with no basis) shows that its reason was never written. Find the reason and let it carry the cases.
- A narrow prescription stays where a real run showed that the reason alone failed, and its ledger incident names the run. A rule that guards custody, the user's data or consent stays explicit.
- One framing implies others, so an edit that adds a sentence looks for the one it makes redundant, and the set is pruned on a schedule.
- It is an untested hypothesis that figures prime useful behavior and that examples teach more strongly than instructions. If a fresh reader cannot restate a skill's duty in ordinary words, or figure nouns leak into output, rewrite the text plain.
- The Glossary in `index` defines the few shared words, and a skill has no private vocabulary.
- Inline the hot path. A stance carries what it always needs, and a pointer serves only the cold path.

## What the check asserts

The set's `check.py` sits in the skills directory, and `execute` gives the command. The check is the list of what it asserts, and each failure names its rule, so no prose here repeats it. Its `--fix` rewrites the two tables it projects from frontmatter, so nobody edits them by hand. Everything the check does not assert is held by review only.

## Writing a stance

The fold is the line between the figure paragraphs under the H1 and the first H2.

- Above the fold, write one figure. A second figure stays only if it compresses rules the first cannot. In two to four sentences, the figure says what the agent may not do, in the figure's own terms. A figure that only licenses dissolves into "be good at this", so cut it.
- Figure nouns stay above the fold. Below it, every sentence uses ordinary words, stays short, and names its actor.
- Cut a sentence that only describes good behavior, such as "rank wisely", because it gives the reader neither a reason nor an act.
- A law carries no dated anecdote, run baseline or source thread, because a reader follows a known specific too literally and the law must fit the next task. The incident goes to the `## Incidents` section of the ledger beside `index`, with its date and the skill and law it backs.
- Write what is always true and what the user cannot be expected to say. Never write what the user will say in the prompt, because the prompt carries it.
- Write no if-then trees. A condition becomes a question to the user or a sibling file.
- A loop has a verdict per round and a stop condition. A pass says it makes one pass and names the artifact it hands over. Either way, the stance hands off by naming the next stance and where the verdict persists.
- Name the stance with the verb the user types mid-sentence. Use a plain verb when the stance is cheap and safe to auto-trigger, and a rarer word when it is expensive or changes mode.
- Keep it as short as the laws allow, with satellites inlined.
- Frontmatter the check does not assert: `argument-hint`, and `disable-model-invocation: true` on a stance only the user may start.
- The description is the router: trigger phrases verbatim, synonyms, and the one case it is not for.

## Style mechanisms

`index` Voice holds the rules of plain prose, and these mechanisms are how a sentence breaks them in any register. The hard sentence to fix is rarely the poetic one. It is usually a plain sentence built wrong.

| Mechanism | What it is | Example | Fix |
|---|---|---|---|
| Elegant variation | a second noun for the same thing | apostle, bird, runner for *agent* | one word per thing, repeated |
| Noun stack | modifiers piled before the head noun | "the one-owner-per-trigger rule" | head noun first, then "of" or a clause |
| Nominalization | a verb turned into a noun, so the actor vanishes | "delegation leaves a wake" | restore the verb and name the actor |
| Verbless fragment | no finite verb | "Reports over messages." | give it a verb |
| Asyndeton | clauses joined by a semicolon, connective implied | "A is B; C goes down D" | write because, so, or but, or split |
| Garden path | a word reads as the wrong part of speech first | "the lens bounds the net" | choose the unambiguous word |
| Metaphoric copula | "X is Y" where Y is a figure | "Relaying is Telephone" | above the fold only; below it, say the mechanism |
| Register splice | a figure noun and a mechanism noun in one clause | "an apostle past its time box" | one vocabulary per sentence |
| Aphorism | a maxim in place of an instruction | "A finding you do not pay for is not a finding" | the instruction and its reason |
| Hedge stack | may, might, consider, worth | "it may be worth considering" | the verdict or the number |
| Filler and puffery | "in order to", inflated verbs, stock AI words | serves as, pivotal, delve, tapestry | the plain word: use, help, many, if |

Four habits produce most of these: stacking metaphors, stacking hedges, restating what was built, and asking permission for reversible work. When you remove a mechanism, keep the meaning and the material caveats, then add an opinion.

## Editing the set

A skill edit is level 9 on `index`'s strength ladder, the weakest. The writer and the reader it governs are the same model in different states, so the writer cannot test the edit on itself.

- Before adding a law, walk the ladder for a type, a projection, a boundary decode, or a guard that can hold the rule instead.
- The user rules on every stance edit. In a sanctioned autonomous session, file the edit as Owed instead of landing it.
- Run the check after any edit. A set that fails the check is not landed.
- A fresh agent, given only the text, proves the edit by doing the intended thing. The writer lists the acts the reader must do before the read starts, and the read passes when the reader does every one. The reader is a model of another family where one is available.
- An edit made after a read is unread until a reader reads it. Fixes go in batches between reads, and only the reads that failed are run again.
- A role charter is edited under these same laws.
- A killed law moves to the ledger beside `index` with the reason it was killed.

## Porting to a new repo

- Slots hold the old repo's facts. Rewrite every `scope: repo` slot under its existing headings. Deleting a section is a verdict, not cleanup. Delete a whole slot only when the new repo cannot fill it at all. Every other stance travels unchanged.
- The ledger does not travel. A port starts a fresh ledger that names the origin, so the design history stays in the origin repo.
- Run the check with `--fix` before first use, because it creates the client's mirror of the set.
