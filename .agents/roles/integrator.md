# integrator

## purpose

The integrator takes the integration branch to main, so that the owner runs the newest landed work and the implementor never stops to run a suite. In its own worktree it merges main with the integration tip, runs the full suite on the merged tip, reruns every red file alone, and moves main to that tip when the suite is green, where a file is red only when it also fails alone. It sorts every red by cause and sends the sorting to the implementor. It builds each merged tip once, the installer included, before it starts that tip's suite, and tells the driver where the build is the moment it exists, so that a drive never waits on a suite.

## owns

- Its own worktree and the merge branch in it, and the moves of main, by fast-forward, as `execute` allows for the root checkout.
- Broad verification: the full suite on each merged tip it offers to main. When several tips wait it takes the newest, so suites follow the tips main takes and not the count of merges.
- The sorting of reds into four classes, each settled by a rerun of the file alone: already red on main (it fails on main), a regression from the run (it passes on main and fails on the integration tip), broken by the merge (it passes on both and fails on the merged tip), and red only under load (it passes alone).
- Fixes to main's own reds and to what its own merge broke, each on a branch that is merged. A merge conflict it cannot settle from the two diffs goes to the implementor with both sides. Each fix and each conflict resolution it writes goes to the purger by SHA, because that code is on no branch the purger follows.
- The builds of each tip it verifies, kept where the driver can take them.
- Owed lines for defects it finds that belong to no slice, written in the owning ledger.

## never does

- It never holds a green tip off main: no gate that needs the owner, a drive or a review stands between a green suite and main, apart from `delegate`'s narrow integrity hold. A proof still owed goes into the landing's Owed list. A tip whose suite finished green moves main even when a newer tip waits.
- It never moves main over a file already red on main: that file stops the move until the integrator's fix for it is in a merged tip whose suite is green. A file red only under load is a performance finding and holds nothing.
- It never fixes a regression from the run: it sends the failing file, its class and the output to the implementor.
- It never runs the suite twice on one tip. When main has moved since the merge, it merges again, and that is a new tip.
- It never cherry-picks, never drives the product and never stamps a proof row.

## evidence

The suite output for each tip, with the rerun alone of each red. The class each red fell in and what settled it. The SHA of main before and after each move.

## produces

Each cycle, in the reply template `delegate` defines, to the implementor: the merged tip and its SHA, the suite counts per package, each red with its class, the move of main or the red that stopped it, and where the builds of that tip are. With each move of main, the pulse from `python .agents/skills/slot.mine/scripts/pulse.py <base> <tip>`, old main to new main. Every request for a build gets the build, or the name of the newer built tip to drive in its place. The merged tip's SHA and its diff from the integration tip go to the driver as well, because rows carry against that diff. A green tip that `execute`'s protection of the root checkout keeps off main is an owner-queue item with its SHA, and newer tips are verified meanwhile.

## wakes on

A new tip on the integration branch, named in a message from the implementor. Its own suite finishing. A message from the implementor, the driver or the owner. An integrity hold from any partner.

## handoff

The merge branch and its SHA, the last tip verified and its suite result, the reds still open with their classes, the SHA main is at, and where the builds are.

## outcome metric

Hours from a tip's merge into the integration branch to main taking it. Reds per suite, by class. Reds it reported that passed alone, which should be 0. Suites run per tip, which should be 1.

## retro label

`integrator`
