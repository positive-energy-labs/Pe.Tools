---
name: control
description: Close a loop over a plant with many agents. Freeze the signatures, send one bounded move per signature, land each one, and stop when the sensor stops seeing them. Trigger on "control", "goal", "/goal", "goal loop", "campaign", "meta-muse", "run the waves", "drive the agents", "overnight", "keep tuning", "surpass the plateau", "run this while I sleep", "set a loop on", "brute force this". Not a build skill; the controller never edits the tree.
disable-model-invocation: true
argument-hint: "Which plant, which sensor, and what may never be done to move it?"
stop: every signature landed, given up, or owed; or two dry waves
figure: Governor — the flyball reads the engine and moves one valve, never the piston
prevents: "the unbounded run: work with no frozen edge, or the same wave sent twice at a plateau"
---
# Control

**Be the Governor.** Watt's flyball governor reads the engine's speed and moves one valve. It never touches the piston. The controller reads the plant through its sensors and moves it through actuators; it never edits the tree, never reads a thread raw, never merges. Implementation history is the contamination that makes a judge worse.

**Freeze the sample.** An instrument measures one sample, never a moving tree. A mission that is a predicate over the world, "until everything is covered", is a run with no edge. The sensor turns it into signatures at one sample, and each signature earns one move per arming.

**A move is bounded or it is not a move.** Every actuator has a timeout, a branch, and two attempts. A move that cannot land gives up and says why, and the next attempt reads why. A blocked signature is a stop the operator sees, never a grind.

## The form

Fill this with the user before wave 0. A form with an empty line is returned, not run. Each line is a row of the controller's declaration, so the form ports without translation.

```
PLANT       what is sampled and moved: a repo at a ref, the branch moves land on
SENSOR      the exact command that prints signatures with a denominator: analyzed, excluded, failed
SIGNATURES  the list at the frozen sample; off-list work is Owed, never done
OBSERVER    what a model estimates that no sensor can; its closed vocabulary; how often
THRESHOLD   when a signature's evidence is enough to move; default two sources agree
ACTUATOR    what makes one move: agent, model, brief, timeout minutes, the files it owns
LIMIT       agents per wave; two attempts per signature, then give up with the reason
MODE        manual: the operator approves each move; auto: the move classes the controller lands alone, each re-openable
GATES       what every move passes before it lands; the honesty bar no move lowers
LEDGER      where receipts and verdicts persist
```

## Laws

- The controller writes the census to disk before it reads anything, then reads summaries and briefs. It never reads a thread or a report bundle raw.
- One actuator owns one signature, or a batch whose files the brief lists. Two actuators never share a file.
- A brief carries the evidence and why the last attempt failed, never the number.
- An actuator stops at its timeout and leaves its work on its branch. The controller never extends a timeout mid-move.
- An integration line lands moves; the controller never merges. A move lands as one receipt someone can open: a green branch, a report file, a ledger line.
- A signature is done when the sensor's next reading no longer sees it, never when the controller judges a predicate true.
- A dismissed signature stays dismissed until its evidence grows. A landed one re-arms only if a later sample still shows it.
- A failed reading is an error, never a zero.
- Baseline the sensor twice, byte-identical, or the first signature is "make it deterministic".
- One gate message per wave, recommendation pre-applied, one-word verdicts.
- One collector wake per wave. No status call after a terminal notification.
- The controller's own round has a timeout and a report, like any actuator.
- Each move gets ADOPT, KILL, or FALSIFIED, with its stake. A falsified mechanism persists as Tried & rejected. At a plateau, change the approach before the same wave goes out again; two dry waves end the loop. Adopting nothing is a legal outcome.
- A law the controller's declaration cannot yet enforce is owed to the controller's own ledger, never patched with more prose here.

Mechanics (sessions, worktrees, waiters) are `execute`'s. Actuator and observer briefs are `delegate`'s. Sensors over session history are `mine`'s. The controller's declaration and ledger are `docs`'.
