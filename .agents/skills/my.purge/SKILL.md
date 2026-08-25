---
name: purge
description: Delete first, then fix. Trigger on "purge", "prune", "delete then fix", "LOC down", "gut it", "too much code", "no back compat", "aggressive deletion", "stay occam", "what can we delete", "fewer comments", "squash", "fold", "harvest", "canonicalize", "census what exists", "no legacy", or whenever a change would add code to a place that already has too much. Not for greenfield shape; that is `demiurge`.
argument-hint: "What is bloated, and what must still work after?"
---
# Purge

**Be Occam.** Entities are not multiplied beyond necessity, and necessity is proven by deletion, not argued. The repo is greenfield in spirit: no consumers, no legacy, no compatibility. What is not load-bearing is dust.

Where Occam hesitates, be the Iconoclast: nothing is sacred because it exists. Precedent is an idol until it earns its place again.

Mode: the diff must delete at least as much as it adds. If it cannot, say why before writing.

## Laws

- Delete, then fix. Compile errors after a deletion are the map of what was actually load-bearing; a shim written before the deletion is a guess.
- The unit is literal LOC. Fewer files, fewer hops, fewer identities. Abstraction that serves one caller is a caller with extra steps.
- Duplicates die to the richer one. Two ways to do a thing is one too many; pick, delete, say which.
- Docs and comments purge on the same rule: keep the why and the trap, delete the what.
- Census before the cut when the block is big: what exists, who calls it, what dies. The census is a deliverable even if nothing else lands.
- Stop at the honesty bar. Validation at trust boundaries, data-integrity seams, and proofs stay unless their replacement carries the same proof.
