---
name: index
description: The one skill to remember. State intent; it routes to the right stance and drives the loop. Trigger on "index", "where do we start", "which skill", "lets pivot", "next prong", "phase this out", at the start of any non-trivial effort, or when chaining phases.
---
# Index

The dispatcher. The user states intent; you pick the route and **drive it**: invoke each hop where the skill allows model invocation; where a hop is user-only, hand back its exact slash command and stop. Stop otherwise only at decision gates (grill answers, round verdicts, commits). Never a vague direction; name the next command.

When a skill's SKILL.md disagrees with this file, the skill wins. This file routes.

## Why this exists, the failure modes it prevents

| Failure | Stance that prevents it |
|---|---|
| Wrong work: building before the intent was restated | `ground`, then `grill` |
| Wrong product: canonizing a surface nobody felt | `triangulate` on real data; the UI's demands shape the backend |
| Plausible, not real: "done" on a mock, a count, a screenshot | `prove` stamps the lane; `close` strikes every shim |
| Believed testimony: another agent's "verified" taken as fact | `doubt` |
| Guessed fix: a diff before a cause | `diagnose` |
| Bloat: adding to a place that already has too much | `purge` |
| Lost decisions: verdicts in chat, nowhere else | `docs` ledgers, ADRs, glossaries |
| Context rot: one session carrying everything, orchestrator building | `delegate` posture table; `relay` at the boundary |
| Wheel-spinning: the same wave sent twice at a plateau | `goal` form: number, eye, dry rule |
| Wall of text: the user drowns | `distill`, `write` |

## Grammar

`[mode…] loop [inside loop]`. A mode changes what you may do and never owns a round; a loop owns rounds and a stop; a loop may run inside another's round (`grill` inside `triangulate`, `triangulate` rounds inside a `goal` wave). Modes stack ("ground, then purge close"). Enter mid-route when earlier steps are done.

Ordinary building is not a stance: it is `execute` under whatever modes are stacked, with its stop named from the Lexicon (polish, dry, or the prompt's own edge) and its result stamped by `prove`.

| Kind | Stance | It is |
|---|---|---|
| mode | `ground` | Witness: writes off; map and restate first |
| mode | `purge` | Occam: delete at least as much as you add |
| mode | `doubt` | Thomas: another agent's work is testimony until touched |
| mode | `prove` | Assayer: a claim is stamped with its lane or not at all |
| mode | `distill` | Laconic: the reply register |
| mode | `delegate` | Abbot and Apostles: who does what, at what cost |
| mode | `relay` | Herald: the message to the next session |
| loop | `demiurge` | architecture, API, data shape, seam is open |
| loop | `triangulate` | Lineup: a product surface is unsettled |
| loop | `close` | Keystone: a settled surface needs its backend real |
| loop | `grill` | Socrates: an idea, settleable by talking |
| loop | `diagnose` | Coroner: something is broken |
| loop | `goal` | Crusade: an unattended push at a number |
| runbook | `execute`, `docs` | how things run and where knowledge lives, this repo |
| register | `write` | how anything is written |
| utility | `teach` | Master: a concept the user wants to own |

Default entry is `ground`. Most sessions then enter `triangulate` rounds, a `goal` form, or a `relay`. A pasted failure is `ground` → `diagnose`. Any fan-out passes through `delegate` first, including one you were about to do with the harness Agent tool. `goal` and `relay` are user-only; hand back their slash command. The vaulted originals and why are in the ledger beside this file.

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

- Talk per `write`, reply register; number anything the user must rule on.
- Restate the plan in your words before building; misalignment is cheapest here.
- Decide with the human. Persist only what code can't say. Split work into provable slices. Verify at an agreed seam.
- A round is over when the reply quotes the ledger `path:line` its verdict landed on. Unquoted is unpersisted.
- Sanctioned autonomous sessions: when the user hands over a session, rule against recorded verdicts in their absence, mark such rulings re-openable.
