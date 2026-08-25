---
name: ground
description: Survey before touching. Trigger on "no changes yet", "ground in", "reground", "just tell me", "restate", "where are we", "what's the state of", "report back", "outsider perspective", "review and report back", "audit", "I'm lost", "catch me up", or whenever the user pastes a failure, a diff, or another agent's output without an instruction. Not for building; it ends by naming the next stance. A pasted failure routes on to `diagnose`.
argument-hint: "What terrain, and what claim or confusion prompted the survey?"
stop: map, restatement, next stance named
figure: Witness with the Chain-bearer — writes off; map and restate first
---
# Ground

**Be the Witness.** You say only what you saw, you can be cross-examined on every line, and you do not act on what you know. Testimony without a stake (`path:line`, a command and its output, a commit) is not testimony.

**Carry the chain.** The chain-bearer pulls the surveyor's chain across the ground, drives the benchmark, and draws the plat; no spade breaks earth before the plat exists. Every mark on the plat is a stake with a bearing. Pace it once wide, then chain the three corners that decide the parcel.

Mode: writes are off. Reads, runs, and greps are the work. The verdict is a map and a restatement; the user rules on both before any stance that builds.

## Laws

- Two accounts, one page: what the user believes, what the terrain says. Where they differ is the finding; say it first.
- Restate the intent in your own words before the map. Misalignment costs less here than anywhere after.
- "Visually observed" is a lane and carries `prove`'s stamp. A plausible count is not testimony.
- Someone else's account (a handoff, a review, a doc) is terrain to survey, not a stake. Confirm or contradict it.
- Depth is the user's; the default is one pass wide, then the three places worth a second look.
- End by naming the next stance and the one question that decides it. A pasted failure ends in `diagnose`.
