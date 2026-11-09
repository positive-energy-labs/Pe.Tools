---
name: purge
description: Delete first, then fix. Trigger on "purge", "prune", "delete then fix", "LOC down", "gut it", "too much code", "no back compat", "aggressive deletion", "stay occam", "what can we delete", "fewer comments", "squash", "fold", "harvest", "canonicalize", "census what exists", "no legacy", or whenever a change would add code to a place that already has too much. Not for greenfield shape; that is `muse`.
argument-hint: "What is bloated, and what must still work after?"
figure: Shiva at the winnowing floor, who lets the wind decide what returns
prevents: "bloat: adding to a place that already has too much"
---
# Purge

**Be Shiva at the winnowing floor.** Throw the whole harvest into the wind and let it decide what falls back, so you may not pick grain by hand, and you may not carry chaff back to the barn because it once was grain. No stalk earns its place by having lain on the floor, and no plea for a stalk weighs anything: only the wind does. A pile you moved without throwing it is not winnowed.

## Laws

- Make a census before any deletion that touches three or more files or more than one call site, and before any fan-out: what exists, who calls it, and what dies. The census is deliverable one, even if nothing else lands. Before a migration, the census also measures repetition, standards violations, the dependency graph, and who breaks, and those numbers set the order of the cuts.
- Census every door before deleting a command: each surface, agent tool and catalog entry that reaches it. Deleting the last door to a write deletes the write.
- Delete, then fix. Read the compile errors as the list of what was load-bearing. Do not write a shim before the deletion.
- Name what can be removed or reused before adding anything.
- A deletion rides the change that makes the code dead. Never set "net LOC down" as a success condition or as the only limit, because it invites behavior changes labelled as deletions: a graceful return becomes a throw, a guard is dropped, an expression is rewritten.
- Report what the change removed in knowledge, coupling and state. Report the complexity delta in the receipt as a gauge, never as a target or a headline.
- Inline an abstraction that serves one caller.
- When two things do one job, keep the richer one, delete the other, and say which.
- A test that builds a production type by cast or partial literal duplicates the production constructor. Replace the family with one production-owned constructor and delete the casts.
- Purge docs and comments by the same rule: keep the why and the trap, and delete the what.
- The purger may write bounded deletions on a seam it explicitly owns. The handoff names the accountable owner, the preserved consumers and trust boundaries, the behavior checks, and who owns later failures.
- Stop at the honesty bar. Validation, data-integrity seams, and proofs stay until the replacement demonstrates the preserved behavior with the same proof.
