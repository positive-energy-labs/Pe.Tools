---
name: tune
description: Make a surface fast and still by measuring first, fixing at the rule, and re-measuring with the same instrument. Trigger on "tune", "perf pass", "make it fast", "it feels slow", "slow to render", "layout shift", "jank", "optimize this", "perf swarm", "caching is bad", "measure it", or when the user reports speed or movement they felt but cannot point at. Not a cause hunt for one failure; that is `diagnose`. Not deletion for its own sake; that is `purge`.
argument-hint: "What feels slow or moves, on which surface, and what instrument could see it?"
stop: before/after from one instrument, rule landed with its guard, purge done, open rulings listed
figure: Tuner with the fork — a temperament, never a string
prevents: "tuned by ear: a constant fixed by hand where a rule should hold"
---
# Tune

**Be the Tuner; strike the fork first.** The tuner never touches a peg before the fork sounds, and never tunes one string to taste: the instrument is set to a temperament, one rule every string obeys, and then the whole scale is played again. A string pulled to a number by ear is flat within the hour. A wolf, one interval that got worse, says the temperament is wrong, not the string. Play the scale yourself after every pass; a pupil's word that it sounds right is not pitch.

Mode: no edit until an instrument has measured the complaint and proven it can register; no number lands where a rule could.

## Laws

- The fork is the first deliverable. Build the instrument that measures the felt complaint directly (interaction timing, hover-to-popover, layout shift with sources, long tasks, bytes and ms per read), and prove it registers before trusting a zero: a zero must be distinguishable from "not observing". It checks the page's health and aborts a run on a reload or a crash screen rather than skipping what vanished.
- A lying lane is a boundary. A throttled tab, a background window, a page reloaded mid-run, a CLI spawn per call: each makes the numbers false, and the first false run is the finding, not a retry. Name the lane the numbers came from.
- Census before any fix, read-only, ranked by share of the damage, with the global fix named per cause and the file:line that proves it. The census is deliverable one even if nothing else lands.
- Tune the temperament. A fix is a rule that makes the whole class impossible (draw only what is on screen; one row height; one placeholder per route until its projection lands; a popover only expands what its row holds), landed in the house document with a guard or a test. A constant that mirrors a size elsewhere is a string tuned by ear: a count comes from the projection or the component that owns it, never a literal.
- The fixing wave is sequenced by collision, not by topic: each agent owns a disjoint file set, and nothing edits the tree while anything measures it, because a save reloads the server and voids the run. Measure, then fix, then measure; never both at once.
- Purge before the final pass, so the numbers judge the final shape and the net line count is reported by bucket.
- Play the scale again with your own hands: re-measure only what the census touched, from the same instrument, and show before and after side by side. Say which fixes held, which did not, and which were never exercised.
- A wolf ends the approach. When a pass makes any number worse, the method was wrong (a guess, a mirror, a mode), and the next move is back to the rule, not a better guess.
- Stop with four things: the before/after table, the rule in the house document with its guard, the purge, and the rulings the user still owes. Mechanics of tabs, sessions and harnesses live in `execute`; who flies which line lives in `delegate`.
