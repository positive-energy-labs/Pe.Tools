---
name: control
description: Close a loop over a plant with many agents. Freeze the signatures, send one bounded move per signature, land each one, and stop when the sensor stops seeing them. Trigger on "control", "goal", "/goal", "goal loop", "campaign", "meta-muse", "run the waves", "drive the agents", "overnight", "keep tuning", "surpass the plateau", "run this while I sleep", "set a loop on", "brute force this". Not a build skill; the controller never edits the tree.
disable-model-invocation: true
argument-hint: "Which plant, which sensor, and what may never be done to move it?"
stop: every signature landed, given up, or owed; or two dry waves
figure: Governor — the flyball reads the engine and moves one valve, never the piston
prevents: "the unbounded run: work with no frozen limits, or the same wave sent twice at a plateau"
---
# Control

**Be the Governor.** Watt's flyball governor reads the engine's speed and moves one valve, and it never touches the piston. So the controller reads the plant only through its sensor and moves it only through actuators: it may not edit the tree, read a thread raw, or merge. It may not read a moving engine either, so it reads one frozen sample, and a valve that will not move within its stroke is reported, never forced.

## The form

Fill this with the user before wave 0. A form with an empty line is returned, not run. Each line is a row of the controller's declaration, so the form ports without translation.

```text
PLANT       what is sampled and moved: a repo at a ref, the branch moves land on
SENSOR      the exact command that prints signatures with a denominator: analyzed, excluded, failed
SIGNATURES  the list at the frozen sample; off-list work is Owed, never done
OBSERVER    what a model estimates that no sensor can; its closed vocabulary; how often
THRESHOLD   when a signature's evidence is enough to move; agreement is weighed per `delegate`
ACTUATOR    what makes one move: agent, model, brief, timeout minutes, the files it owns
LIMIT       agents per wave; two attempts per signature, then give up with the reason
MODE        manual: the operator approves each move; auto: the move classes the controller lands alone, each re-openable
GATES       what every move passes before it lands; the honesty bar no move lowers
LEDGER      where receipts and verdicts persist
```

## Laws

- The sensor turns a mission stated as a predicate ("until everything is covered") into signatures at one frozen sample. Each signature earns one move per arming.
- The controller writes the census to disk before it reads anything, then reads summaries and briefs. It never reads a thread or a report bundle raw.
- One actuator owns one signature, or a batch whose files the brief lists. Two actuators never share a file.
- Every actuator has a timeout, a branch, and two attempts. A move that cannot land gives up and says why, and the next attempt reads why. The operator sees a blocked signature as a stop.
- A brief carries the evidence and why the last attempt failed, never the number.
- An actuator stops at its timeout and leaves its work on its branch. The controller never extends a timeout mid-move.
- An integration thread lands moves, and the controller never merges. A move lands as one receipt someone can open: a green branch, a report file, or a ledger line.
- A signature is done when the sensor's next reading no longer sees it, never when the controller judges a predicate true.
- A dismissed signature stays dismissed until its evidence grows. A landed one re-arms only if a later sample still shows it.
- Record a failed reading as an error, never as a zero.
- Baseline the sensor twice. If the two readings are not byte-identical, the first signature is "make it deterministic".
- Send one gate message per wave, with the recommendation pre-applied and one-word verdicts.
- Wake the collector once per wave. Make no status call after a terminal notification.
- The controller's own round has a timeout and a report, like any actuator.
- Each move gets ADOPT, KILL, or FALSIFIED, with its evidence link. A falsified mechanism persists as Tried & rejected. At a plateau, change the approach before the same wave goes out again. Adopting nothing is a legal outcome.
- Use a dedicated governor only by owner ruling, never by default. When repeated corrections leave the governing assumption unchanged, start a new thread with the goal, the authoritative constraints, and targeted current evidence. A stale ledger or checkpoint is not enough to brief it.
- Owe a law the controller's declaration cannot yet enforce to the controller's own ledger. Do not patch it with more prose here.

Mechanics (sessions, worktrees, waiters) are `execute`'s. Actuator and observer briefs are `delegate`'s. Sensors over session history are `mine`'s. The controller's declaration and ledger are `docs`'.
