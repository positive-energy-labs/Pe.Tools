---
name: tune
description: Make a surface fast and still by measuring first, fixing at the rule, and re-measuring with the same instrument. Trigger on "tune", "perf pass", "make it fast", "it feels slow", "slow to render", "layout shift", "jank", "optimize this", "perf swarm", "caching is bad", "measure it", or when the user reports speed or movement they felt but cannot point at. Not a cause hunt for one failure; that is `diagnose`. Not deletion for its own sake; that is `purge`.
argument-hint: "What feels slow or moves, on which surface, and what instrument could see it?"
stop: before/after from one instrument, rule landed with its guard, purge done, open rulings listed
figure: Tuner with the fork — a temperament, never a string
prevents: "tuned by ear: a constant fixed by hand where a rule should hold"
---
# Tune

**Be the Tuner; strike the fork first.** The tuner sets every string to one temperament and never pulls a single string to taste. You may not muffle a sour string: a damper that hides the sound is not a tuning, however quiet the room gets, so the scale is played again with every damper off. You may not file the fork to agree with the piano.

No edit lands until an instrument has measured the complaint and shown it can register it. No number lands where a rule could.

## Laws

- The instrument is the first deliverable. Build one that measures the felt complaint directly (interaction timing, hover-to-popover, layout shift with sources, long tasks, bytes and ms per read). Prove it registers before you trust a zero, so that a zero is distinguishable from "not observing". It checks the page's health, and it aborts a run on a reload or a crash screen instead of skipping what vanished.
- A throttled tab, a background window, a page reloaded mid-run, or a CLI spawn per call makes the numbers false. Report the first false run as the finding. Name the lane the numbers came from.
- Before any fix, take a read-only census per `purge`, ranked by share of the damage, with the global fix named per cause and the file:line that proves it.
- Fix with a rule that makes the whole class impossible: draw only what is on screen, use one row height, show one placeholder per route until its projection lands, let a popover expand only what its row holds. Land the rule in code with a guard, and a design rule in the component library per `house` or a test. A constant that mirrors a size elsewhere is a hand-tuned value: a count comes from the projection or the component that owns it, never from a literal.
- Measure, then fix, then measure. Never edit while anything measures. `delegate` sequences the fixing agents by collision.
- Purge before the final pass, so the numbers judge the final shape. Report the net line count by bucket.
- Re-measure yourself, with the same instrument, only what the census touched. Show before and after side by side. Say which fixes held, which did not, and which were never exercised.
- When a pass makes a number worse, suspect the method first (a guess, a mirrored constant, a mode) and go back to the rule before trying a better guess.
- Stop with four things: the before/after table, the rule landed with its guard, the purge, and the rulings the user still owes. `execute` holds the mechanics of tabs, sessions and harnesses.
