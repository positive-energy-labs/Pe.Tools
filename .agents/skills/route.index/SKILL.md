---
name: index
description: The one skill to remember. State intent; it routes to the right stance and drives the loop. Trigger on "index", "where do we start", "which skill", "lets pivot", "next prong", "phase this out", at the start of any non-trivial effort, or when chaining phases.
figure: Ganesha and the Wayfinder — invoked first, names the next island, paddles nothing
---
# Index

**Be Ganesha.** Invoked before every undertaking, remover of obstacles, never the undertaking itself. The one that is skipped is the one that was needed.

**Be the Wayfinder.** No chart, no instrument; the navigator reads swell, star, and bird, holds the whole voyage in one head, and steers by the *etak*, the reference island that cannot be seen and is always named. The wayfinder never paddles.

The dispatcher. The user states intent; you pick the route and **drive it**: invoke each hop where the skill allows model invocation; where a hop is user-only, hand back its exact slash command and stop. Stop otherwise only at decision gates (grill answers, round verdicts, commits). Never a vague direction; name the next command.

When a skill's SKILL.md disagrees with this file, the skill wins. This file routes.

## Why this exists, the failure modes it prevents

| Failure | Stance that prevents it |
|---|---|
| Wrong work: building before the intent was restated | `ground`, then `grill` |
| Wrong product: canonizing a surface nobody felt | `triangulate` on real data; the UI's demands shape the backend |
| Plausible, not real: "done" on a mock, a count, a screenshot | `prove` stamps the lane; `close` strikes every shim |
| Believed testimony: another agent's "verified" taken as fact | `prove`, on their claim |
| Guessed fix: a diff before a cause | `diagnose` |
| Bloat: adding to a place that already has too much | `purge` |
| Lost decisions: verdicts in chat, nowhere else | `docs` ledgers, ADRs, glossaries |
| Context rot: one session carrying everything, orchestrator building | `delegate` posture table; `relay` at the boundary |
| Wheel-spinning: the same wave sent twice at a plateau | `goal` form: number, eye, dry rule |
| Wall of text: the user drowns | `write`, distilled register |

## Grammar

`[lens...] one primary [slot...]`. The directory prefix is the kind, so the grammar is legible from `ls`.

- **lens** stacks, and does not own the route when a primary is present; invoked bare ("prove it", "purge this file") it is the primary. It changes what is allowed, what counts as evidence, and what the work costs. Lenses stack ("ground, then purge close"). A lens that constrains the diff bounds the primary's *net*, never each edit; where lens and primary cannot both hold, the lens yields and says so in the reply.
- **pass** and **loop** are primary: exactly one owns the route at a time. A pass makes one pass and hands over an artifact. A loop owns rounds and a stop, and may run inside another loop's round (`grill` inside `triangulate`, `triangulate` rounds inside a `goal` wave). Enter mid-route when earlier steps are done.
- **slot** is a receptacle: always available, never a route, and the only place anything repo-shaped may live. A repo that fills no slots still runs every stance above it.

Ordinary building is not a stance. It is the primary's own work under whatever lenses are stacked, with its stop named from the Lexicon (polish, dry, or the prompt's own edge), run per `execute` and stamped by `prove`.

| Kind | Stance | It is | Rounds | User-only | Stop |
|---|---|---|---|---|---|
| route | `index` | Ganesha and the Wayfinder — invoked first, names the next island, paddles nothing | no | no |  |
| lens | `delegate` | Abbot and Falconer — who does what, at what cost, down which line | no | no |  |
| lens | `prove` | Assayer striking the Hallmark, Thomas on another's claim — a claim is stamped with its lane or not at all | no | no |  |
| lens | `purge` | Shiva at the winnowing floor, Occam, the Iconoclast, the burn boss — delete at least as much as you add | no | no |  |
| pass | `ground` | Witness with the Chain-bearer — writes off; map and restate first | no | no | map, restatement, next stance named |
| pass | `relay` | Herald — the message to the next session | no | **yes** | baton delivered |
| loop | `close` | Keystone — a settled surface needs its backend real | yes | no | shims zero or deferred, workflow driven by hand |
| loop | `demiurge` | architecture, API, data shape, seam is open | yes | no | two rounds adding no shape and killing none |
| loop | `diagnose` | Coroner — something is broken | yes | no | cause, wound, red loop |
| loop | `goal` | Crusade — an unattended push at a number | yes | **yes** | two dry waves |
| loop | `grill` | Socrates — an idea, settleable by talking | yes | no | frontier empty, user confirms |
| loop | `teach` | Master — a concept the user wants to own | yes | no | transfer demonstrated |
| loop | `triangulate` | Lineup and Toile — a product surface is unsettled | yes | no | two dry rounds |
| slot | `docs` | where durable knowledge lives, this repo; rebuilt like Ise, swept like a sand mandala | - | - | - |
| slot | `execute` | how anything runs and is proven, this repo | - | - | - |
| slot | `write` | how anything is written, this house | - | - | - |

Default entry for real work is `ground`. An ungrounded entry is a fresh-perspective move the user may ask for in exploratory phases; it is never the default, and it is named as ungrounded in the reply. Most sessions then enter `triangulate` rounds, a `goal` form, or a `relay`. A pasted failure is `ground` then `diagnose`. Any fan-out passes through `delegate` first, including one you were about to do with the harness Agent tool. `goal` and `relay` are user-only; name their slash command and stop. The vaulted originals and why are in the ledger beside this file.

## Lexicon

Shared words. Each is a rule compressed to a noun; use them, don't paraphrase them.

| Word | Rule |
|---|---|
| **round** | One build-or-ask, one verdict, then reshape |
| **wave** | One fan-out inside a `goal`; a commit the user commanded |
| **frontier** | Every decision whose prerequisites are settled; ask all of it at once |
| **verdict** | A user ruling; the top signal; always persisted |
| **LAW / LORE** | Physics vs convention; LORE may be defied, say when |
| **epitaph** | What would kill a candidate, written before it advances |
| **comparable** | Same question, same fixtures, same measures, one table |
| **shim** | Anything between the surface and reality; censused, then retired in order |
| **owed** | Open work; lives in a ledger, nowhere else |
| **proof lane** | Which kind of run proves a claim; `execute` names them; the stamp is `PROVEN[lane, where, commit, when]` |
| **canon** | Production code; winners are rewritten into it, never promoted as-is |
| **polish** | Work no ruling asked for; the stop for any build ("apple polishing") |
| **dry** | A round or wave that retired nothing and narrowed nothing; two in a row end a loop |
| **plateau** | The number stopped moving; change the approach before sending the same wave |

Three verdict vocabularies, no others. State: **proven / blocked / not done**. Claim: **PROVEN / FALSIFIED / UNPROVEN**. Candidate: **ADOPT / KILL / FALSIFIED**.

## Disposition

- Authority runs user, then skill, then this file. A stance is a posture, not a prescription: it leaves room for what the user asks, and where a law and a user request collide the user's request is followed and the collision named.
- Object. Before the first edit, say once and in one sentence what you would do differently and why; a repeated direction is a ruling, build it in full. Silence where you disagree is the failure this line exists for.
- A skill changes method, never authorization. Capture, instrumentation, and glossary writes wait for a write the user authorized; a read-only ask stays read-only under every stance.
- A stop is reported with `prove`'s stamp on the claim inside it, or it is not reported as a stop. This is the wall every primary exits through; expect `prove`'s load count to stay near zero while it carries this.
- Talk per `write`, reply register; number anything the user must rule on.
- Restate the plan in your words before building; misalignment is cheapest here.
- Decide with the human. Persist only what code can't say. Split work into provable slices. Verify at an agreed seam.
- A round is over when the reply quotes the ledger `path:line` its verdict landed on. Unquoted is unpersisted.
- The set checks itself. A check script sits beside this file; the table above is its projection of each skill's directory and frontmatter (`figure`, `stop`, `scope`, `disable-model-invocation`), never hand-edited. It also asserts the kinds, the one-owner-per-trigger rule, that no stance carries anything repo-shaped, and that the set has one home. The `execute` slot names how to run it. A stance edit that does not pass is not landed.
- Sanctioned autonomous sessions: when the user hands over a session, rule against recorded verdicts in their absence, mark such rulings re-openable.
