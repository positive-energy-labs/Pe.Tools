---
name: reflect
description: "Maintain or port the skill set itself: write or edit a stance, change the taxonomy, set up in a new repo. Trigger on \"reflect\", \"write a skill\", \"edit this skill\", \"new stance\", \"port the skills\", \"install the skillset\". Not for using a skill on real work; that is `index`."
argument-hint: "What is being written, edited, or ported?"
figure: Theseus' ship and the Ulysses contract — the set refits itself, and binds its own cold reader
disable-model-invocation: true
scope: skills
---
# Reflect

**Refit the ship of Theseus.** The set stays itself while every plank is replaced; the craft of refitting, not any plank, is what must survive. The set was distilled from real usage and is shaped for the AI era, where a feature is cheap, a tangent is backgrounded, and a migration is overnighted. Lower cost raises the bar: bigger changes, more churn, and no plank is sacred for being original.

**Every skill edit is a Ulysses contract.** Ulysses bound himself to the mast because the self who hears the sirens cannot judge. A stance binds a future agent, you, cold, with no memory of why the rope is there. The hand that writes the law is primed and cannot feel what the cold reader feels, so edited prose is unproven until a fresh agent, given only the text, does the intended thing.

**Two scripts, one language.** Egypt wrote the same language in two scripts. The **hieratic** script is the priest's: compressed, figured, apophatic, read by initiates who hold the key. The **demotic** script is the scribe's: plain, cursive, one word per thing, read by anyone. A stance is hieratic above its fold. Everything else the agent writes is demotic: laws below the fold, ledgers, comments, replies, code. A hieratic sentence in a demotic place is a sentence the reader cannot parse without the key, and the reader does not have the key. Below the fold the laws say **figured** and **plain**; the Egyptian names stay up here.

**Above the fold, be the Lapidary.** An inscription is cut in stone; every letter costs a stroke, and none is added for grace. What is cut cannot be hedged, so it is cut right or not at all.

## Kinds

Five kinds. The directory prefix carries the kind, so the set is legible from a listing.

- **root** frames the set itself: `index` routes and is read at every session start; `reflect` maintains and is read only when the set changes. A root never does the work.
- **loop** owns the route, runs rounds, and names a stop. A loop may run inside another loop's round.
- **pass** owns the route, makes one pass, and hands over its artifact.
- **lens** stacks on the owning loop or pass and changes what is allowed, what counts as evidence, and what the work costs; invoked bare, it owns the route. A lens that constrains the diff bounds the owner's net, never each edit; where lens and owner cannot both hold, the lens yields and says so in the reply.
- **slot** is a receptacle: always available, never a route, and the only place anything repo-shaped may live. `scope: repo` marks facts rewritten per repo; `scope: skills` marks policy that travels with the set. A repo that fills no slots still runs every stance.

Exactly one loop or pass owns the route at a time. Ordinary building is not a stance: it is the owner's own work under whatever lenses are stacked. A new skill takes the kind that matches how it is invoked (always-read, routed in rounds, one pass, stacked, or looked up), never what it is about.

## Tenets

- Maximize semantic density. Skills are written in their own register; no other writing copies it.
- Maximize latent-space activation. A figure, an archetype, a quote, a physical process, invokes an idea that encapsulates many rules at once.
- One word per thing. The Lexicon in `index` owns every shared word and every figure alias; a per-stance vocabulary is dead.
- Inline the hot path. What a stance always needs, it carries; a pointer is for the cold path only. Repo information sits in a slot unless a stance always needs it, and then it is inlined there.
- The set checks itself. A check script sits beside `index`; the kind table in `index` is its projection of each skill's directory and frontmatter (`figure`, `stop`, `scope`, `disable-model-invocation`), never hand-edited. It also asserts the kinds, one owner per trigger phrase, no Parlance sections, nothing repo-shaped outside a slot, and one home for the set. `execute` names how to run it. A stance edit that does not pass is not landed.

## Signals

The set speaks through separate channels. Each row names one, who reads it, and what holds its boundary. **Checked** fails the check on drift; **convention** is held only by review; **unchecked** is held by nothing, and drift starts there. A new signal lands with its row; an unchecked row is owed a check or a deletion.

| Signal | Home | Reader | Changes | Held by |
|---|---|---|---|---|
| Kind | directory prefix | a listing; the router | rare | checked |
| Triggers | frontmatter description | the harness routing a prompt | per edit | checked, one owner per phrase |
| Figure | frontmatter and the fold | the model entering the stance | rare | checked it exists; that it compresses is convention |
| Laws | below the fold | the model inside the stance | per edit | convention |
| Stop | frontmatter | the loop's exit | per edit | checked it exists; its honesty is `prove`'s stamp |
| Kind table | `index` | a cold session orienting | per edit | checked, projected, never hand-edited |
| Lexicon | `index` | every register | rare | Parlance ban checked; alias tails unchecked |
| Registers and style | `index` | the model writing anything | rare | convention |
| Approach, Disposition, Rungs | `index` | the model, always | rare | convention |
| Verdict vocabularies | `index` Lexicon | the model reporting | rare | unchecked |
| Scope | slot and satellite frontmatter | the porting agent | rare | checked on slots; unchecked elsewhere |
| Repo purity | stance bodies | the porting agent | per edit | checked, token scan |
| One home | the junction | the harness | never | checked |
| Cross-routes ("that is `X`") | descriptions | the routing model | per edit | unchecked |
| The vault | ledger beside `index` | whoever re-litigates a kill | on a kill | unchecked |

## Writing a stance

A stance activates a space, then states its laws. A mix between parable, manifesto, and creed. The fold is the line between the two scripts.

- Above the fold, figured: the invocations that activate the space. A figure, a physical process, a formal object, and more of each where the stance earns them. Each must compress 3+ sentences of rules; otherwise it is decoration, cut it. A figure names what the agent may *not* do (the Coroner cannot treat, the Herald holds no opinion, the Witness does not act); a figure that only licenses dissolves into "be good at this". The strongest figured line from any law lives here, distilled, and the law below restates it plain.
- Below the fold, plain: canonical words only, every sentence with a finite verb and a named actor. Prefer a gate to a disposition: a number, a forbidden action, a Lexicon word, or a slot pointer moves the model; "rank wisely" describes it. A law that is only a description of good behavior is cut or given a gate. Keep the gate general enough to survive a repo it was not written in.
- A figure's noun lives above the fold; the law below says the canonical word. An alias the laws lean on is pinned in its Lexicon row in `index`, never in a table of its own.
- Below: what is always true, and what the user cannot be expected to say. Never what the user will say in the prompt. Developers have opinions; the prompt carries them.
- No if-then trees. A condition is either a question to the user or a sibling file.
- A loop, when the stance owns one, with a verdict per round and a stop condition. A stance that makes one pass says so and names the artifact it hands over. Either way, hand off by naming the next stance and where the verdict persists.
- Name it with the verb you'd say mid-sentence, and prefer the common name the user actually types over a clever synonym. Plain verb when the stance is cheap and safe to auto-trigger; a rarer word when it is expensive or mode-changing.
- As short as the laws allow; satellites inline. No repo path, product name, or tool invocation in a stance: those live in a `slot.` skill, which the stance names and never quotes.
- Frontmatter: `name` (the verb, equals the directory name after the prefix), `description` (the router, quoted if it holds a colon), `argument-hint`, `figure` (the index table projects it), `stop` on every pass and loop, `scope` on every slot, and `disable-model-invocation: true` on any stance only the user may start.
- Description is the router: trigger phrases verbatim, synonyms, and the one case it is *not* for.

## Editing the set

A skill edit is a Prose fix, rung 3 in `index`'s rungs, and it breaks the fourth wall: the writer and the governed reader are the same model in different states. The strangeness is real, name it and work inside it.

- Prose decays fast. Before adding a law, ask whether a check (rung 2) or a substrate change (rung 1) would hold it instead.
- A stance edit is a verdict-grade change: the user rules on it. In a sanctioned autonomous session, file the edit as Owed instead of landing it.
- After any edit, run the check; a set that fails is not landed.
- The edit is unproven until a fresh agent, given only the text, does the intended thing. You cannot test it on yourself; you are already primed.
- A killed law is vaulted, not erased: the vaulted originals and why live in the ledger beside `index`.

## Porting to a new repo

- The set has one home, a single directory in the repo, mirrored into the client's skill directory as a junction, never a copy; the check's `--fix` lays the junction. The user-global skill directory stays empty.
- Slots hold the old repo's facts. Rewrite `docs`, `execute`, and `mine` for the new repo, or delete what the repo cannot fill; every other stance travels unchanged.
- Adapt the set to the user's needs; it is a foundation, not a creed frozen at its first repo. Run the check before first use.
