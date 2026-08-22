# The delegated convergence loop

A rig for running an unattended, multi-agent push at a measurable frontier. You are the
orchestrator. **You never write code.** Everything that touches the tree is delegated.

The spirit is `demiurge` + `find-the-product` + `prototype`: **fan out on everything plausible at
once, let the metric and the eye kill most of it, keep the survivors, repeat.** A round that
retires nothing and narrows nothing produced no information — that is the failure mode this rig
exists to avoid, and it is why builders go wide and simultaneous rather than deep and sequential.

Fill in the mission block, then start at Round 0. Nobody will answer questions while this runs.

---

## Cast

| Role | Who | Edits code | Lives |
|---|---|---|---|
| **orchestrator** | you (Fable) | never | the session kaitpw opened |
| **builders** `b1..bN` | Codex, reasoning **high** | yes, only in their own worktree | one Herdr session per worktree |
| **idea** | Claude Opus 5, medium | never | the standing session, spawned when needed |
| **eyes** | Claude Opus 5, medium — **fresh instance every time, never reused** | never | spawned per checkpoint, stopped after |
| **sdkfix** | Codex | yes, in the SDK worktree only | the standing session |

Your job is the frontier, the fan-out, the cherry-pick, and the ledger. You read reports, numbers,
and diffs; you merge; you decide. You do not implement, do not run the solver, do not hand-fix a
builder's diff. If a winner needs a change, that is a builder's next round.

A builder is cheap and disposable. Reaching for the keyboard yourself is the expensive mistake:
it burns your context on implementation history, which is exactly the contamination that makes you
a worse judge of the work.

---

## Mission block — fill this in before Round 0

```
MISSION      one sentence, kaitpw-locked. What gets better, and the thing you may never do to get it.
BASE         <abs path to the base worktree>            BRANCH  <branch>
BRIEF        <the standing brief doc>                   TASTE   <the doc whose verdicts outrank the metric>
LEDGER       <docs/features/<name>/LEDGER.md — Decided / Tried & rejected / Owed>
CURRENCY     <exact command that prints the number, and which number it is>
GATES        <exact command(s) that must be green; the honesty bar no candidate may lower>
BACKLOG      <where hypotheses come from today>
BIG_MOVE     <the metric delta that earns an image checkpoint>
FLAT_RULE    metric-only | eyes-can-carry   (eyes-can-carry: a flat-CURRENCY candidate may adopt on a
             visual ADOPT if a NAMED secondary number moved; name the number here)
WIDTH        <builders per round>                       TIMEBOX <minutes per builder per round>
AMBITION     knobs-first | code-first   (code-first: builders may restructure stages and models;
             gates and honesty bars are still untouchable)
RUNS         <abs dir where every round's artifacts land>
```

Anything not in that block is loop, and the loop below does not change per mission.

<details><summary>The filled block for the 2026-08-21 run (loop2)</summary>

```
MISSION      Raise accepted coverage on project-a by making more geometry honestly pass the existing
             gates - never by loosening gates. Reframed off THINK-3: the dead backlog is dead.
BASE         C:\Users\kaitp\source\repos\Pe.Tools-takeoff-frontier   BRANCH  takeoff-frontier
BRIEF        docs/features/takeoffs/TUNING.md                        TASTE   TASTE.md (repo root of BASE)
LEDGER       docs/features/takeoffs/LEDGER.md
CURRENCY     python eval/rhvac/score-looks-good.py score <run>/report.json -> board v1.1 savedWork
             secondary (named, for FLAT_RULE): accepted double-line residue ft (r7: 980.7),
             per-room edgeOnInk, accepted rooms / sf
GATES        dotnet test source/Pe.Takeoff.Tests -c Debug (143 green at r7), and no already-accepted
             room's edgeOnInk falls by more than 0.005 (per room; zone/board means are diagnostic)
BACKLOG      THINK-3 + ADDENDUM reframe (.artifacts/runs/overnight/), the three 2026-08-21 taste
             rulings in TASTE.md, LEDGER Owed. Not the TUNING H1..H5 lines - THINK-3 closed them.
BIG_MOVE     savedWork +0.010 cumulative since the last checkpoint
FLAT_RULE    eyes-can-carry; secondary = accepted double-line residue ft
WIDTH        3                                          TIMEBOX 60
AMBITION     code-first. No Revit: raster lane only, Revit stays at zero.
RUNS         C:\Users\kaitp\source\repos\Pe.Tools-takeoff-frontier\.artifacts\runs\loop2\
             baseline = ..\overnight-r7\report.json (savedWork 0.3736, immutable r0 anchor 0.3660)
```
</details>

---

## Herdr, the minimum you need

One session per worktree; panes inside it are named agents. The scripts live in the main checkout at
`C:\Users\kaitp\source\repos\Pe.Tools\.claude\skills\execute\`:

```
herdr-up.ps1   <session> <cwd> <name>:<kind>[:<model>] ...   # idempotent; creates server, workspace, panes
herdr-send.ps1 <session> <name> <abs path to prompt file>    # one hop, verified delivered
herdr-wait.ps1 <session> <name> <timeout ms>                 # background it; its verdict is the truth
```

`<kind>` is `codex` or `claude`; `<model>` maps to `--model`, so builders are `b1:codex`, the thinker
is `idea:claude:opus`, a reviewer is `rev3:claude:opus`.

Non-negotiable mechanics, all of which have burned somebody: pass `--session <S>` on **every**
`herdr` command and never rely on the default session or `--current`. Health comes from
`agent list` — `idle`/`done` means complete, `blocked` means it needs input, `unknown` proves
nothing. One prompt owner per agent: if you send while a builder is mid-task you have corrupted its
round. Never drive slash commands through `send-text` from Git Bash; `agent prompt` owns `/`. To
redirect an agent urgently, `send-keys <name> esc`, verify it settled, then re-prompt. Read the
version-matched manual with `herdr --skill` before improvising.

Stand up a standing session on `BASE` for `idea`, `eyes`, and `sdkfix`; stand up one throwaway
session per builder worktree per round and tear it down when the round ends.

The full mechanics are in the main checkout's `execute` skill — read the "Herdr", "Sessions and hot
reload", and "Documents and op receipts" sections there, not a worktree's copy, which will be stale.

---

## Round 0 — establish the floor

Delegate it to one builder. It ends with: the base worktree green on GATES, one baseline run
snapshotted under `RUNS/r0/`, the CURRENCY number recorded, and a committed tree. Read `BRIEF`,
`TASTE`, and `LEDGER` yourself while that runs — you need the tombstones. **Never re-try a
tombstone without new evidence.**

If the baseline number disagrees with what the docs claim it is, that is Round 0's real finding.
Stop and say so in `RUNS/SUMMARY.md`; a wrong baseline poisons every comparison after it.

Round 0 also owes three things the first run learned the hard way:

- **Identity check.** Run the baseline twice, no-op. Room ids, dispositions, and polygons must be
  byte-identical, or the per-room honesty bar is undefined and every A/B on that fixture is noise.
  If it fails, the first fan-out's top hypothesis is "make identity stable / additive-only
  candidate path", not coverage.
- **Merge audit.** If `BASE` is a branch behind `main`, the merge that brought it current is
  audited (conflict files named, resolution read) before any fan-out builds on it.
- **Taste closure.** Every open "FOR kaitpw" call from the last `SUMMARY.md` gets a TASTE line -
  kaitpw's answer, or a recorded default with the date. No fan-out runs over an unanswered taste
  question; builders would otherwise build on a coin flip.

Round 0 and Round 1 may overlap when the baseline snapshot already exists on disk and Round 1's
slate does not depend on the identity check; the cost of being wrong is one round.

---

## Round N — fan out, harvest, cherry-pick, graft

**1. Fan out.** Pick **3–5 hypotheses that are mutually exclusive in mechanism**, not variations of
one idea. Overreach deliberately on at least one; a slate pruned for feasibility teaches nothing.
Rank them from `BACKLOG`, the last `idea` report, and the losers' salvaged ideas from last round.

Each builder gets its own worktree and its own Herdr session, because they will collide on the same
artifact paths otherwise:

```
git -C BASE worktree add ../<repo>-r<N>b<k> -b <branch>-r<N>b<k>
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\kaitp\source\repos\Pe.Tools\.claude\skills\execute\herdr-up.ps1 <mission>-r<N>b<k> <that worktree> b<k>:codex
powershell ... herdr-send.ps1 <mission>-r<N>b<k> b<k> <abs path to the filled p-builder.md>
```

Send all of them before waiting on any of them. Then background one waiter per builder
(`herdr-wait.ps1 <session> b<k> 3600000`) and wait on the set.

**2. Harvest.** A builder that hits `TIMEBOX` writes its report with what it has (`Gates: NOT RUN`
is a legal line) and stops; a timeboxed builder is a data point about the mechanism's cost, not a
failure to hide. Each builder wrote `RUNS/r<N>b<k>/REPORT.md`: one paragraph of claim, the score
table against the current baseline, the gate results, and a falsifier. Read the reports and the
diffs. **A pasted proof is a claim until you re-run it** — for the candidate you intend to adopt,
re-run CURRENCY and GATES yourself in its worktree before merging.

**3. Cherry-pick.** Adopt at most one mechanism per round. Adopt only if CURRENCY improves, GATES
are green, and the honesty bar held. A tie with no gain is a reject. Then read the losers for parts:
a rejected mechanism often contains one idea that belongs in a winner. Name those explicitly — they
are next round's fan-out, and salvaging them is most of the value of running wide.

**4. Graft.** Merge the winner into `BRANCH`, in dependency order if more than one landed. One dated
line in `LEDGER` per outcome: Decided for the adopted mechanism, Tried & rejected for each loser with
its numbers and the reason. The winner becomes the new baseline. Remove the round's worktrees
(`herdr session stop` first — the pane holds the directory) and let their branches die.

**5. Rewrite `RUNS/SUMMARY.md` every round, overwriting.** The morning read must always be current.
Colloquial, not a wall of numbers: where the frontier is, what moved it, what is now believed dead,
and the open calls for kaitpw with your recommended default for each.

---

## The image checkpoint

Deterministic gates run every round. **The eye runs rarely** — only when the metric moved enough
that a human would want to look:

> Fire a checkpoint when the cumulative adopted CURRENCY delta since the last checkpoint reaches
> `BIG_MOVE`, when any single adopted round exceeds the largest adopted delta so far, or **before
> graft** on any single round whose delta is at least `BIG_MOVE / 2` (the metric rewarded new bad
> walls twice in the first run; a big single jump is exactly when the metric is least trusted).

Under `FLAT_RULE = eyes-can-carry` a candidate with flat CURRENCY, green GATES, honesty held, and
the named secondary number moved the right way is **eligible**, not adopted: it earns an immediate
checkpoint of its own, and adopts only on that ADOPT. Flat plus nothing named is still a reject.

At a checkpoint the whole fan-out **stops** until the verdict lands. Spawn a fresh `eyes` (a name
never used before), send it `p-eyes.md` filled in, and let it see **only the panels and the
comparison — never your narrative, never the reports**. A stranger who knows nothing about why the
change was made is the only reviewer whose praise means anything.

The price of looking rarely is that a REJECT unwinds the **whole block since the last checkpoint**,
not just the last round. Take the whole block back to the last checkpointed commit, record every
rolled-back mechanism as Tried & rejected with the reviewer's words verbatim, and treat the
reviewer's specific complaint as the highest-ranked hypothesis of the next fan-out. That cost is the
reason `BIG_MOVE` is a real number and not "whenever it feels big".

Stop the `eyes` pane when its verdict is read. Never reuse one.

---

## When the fan-out goes dry

Two consecutive rounds where nothing adopts, or a round whose whole slate came back "no effect", is
not a signal to try harder in the same direction. It is a signal that the frame is wrong.

Spawn `idea` with `p-idea.md`. It thinks; it never edits, never runs the solver, never commits. It
returns a ranked reframe: what the evidence now says the real lever is, which backlog lines it
declares dead, and what it would need to see to change its mind. Rebuild the next fan-out from that
report. If it says a line of work is dead, stop that line.

If `idea` says the backlog is dry **and** the last two rounds adopted nothing, write the final
`SUMMARY.md` and go idle with a clean tree. Stopping on a dry frontier is a result. Grinding out
four more rejected rounds is not.

---

## Tooling defects — delegate, never fix, never block

When the SDK, the host, or the harness misbehaves: do not fix it, do not work around it silently,
and do not let it stall the round.

**The rule that was broken last time: a defect named in any report must exist as a queue file
first.** A defect described in prose and never filed is a defect nobody is working on, and it will
still be open in the morning while the report implies it was handled.

Write `<queue dir>/<NN>-<slug>.md` containing only: the problem in two sentences, the exact repro
commands with their tee'd output paths, and the expected behavior. Send it to `sdkfix`. Continue the
round with a workaround or a different hypothesis. `sdkfix` owns the whole reproduce → fix → gate →
release → re-pin cycle and drops `<NN>-<slug>.done.md` beside your file.

---

## Rules that do not bend

- Never touch `C:\Users\kaitp\source\repos\Pe.Tools` (the main checkout — kaitpw's uncommitted work
  lives there) except to **read** skills and **run** the `herdr-*.ps1` scripts.
- Never `git add -A`, never `commit -a`. Commit by pathspec.
- Never loosen a gate constant, a threshold, or an honesty bar to make a candidate pass. The mission
  is to make more things honestly pass the gates that exist.
- Never leave an unadopted diff in a tree. Reject means revert, now.
- Never reuse an `eyes`. Never let a builder decide adoption. Never implement anything yourself.
- Every round boundary leaves a committed tree and a written report, so a crash costs one round.
- Verdicts that matter to kaitpw go in `LEDGER` and nowhere else — not in commit messages, not only
  in `SUMMARY.md`.
- Time on task that felt wrong is signal. Builders are told to report it; you surface it in
  `SUMMARY.md`. A subagent grinding for an hour on something that should have taken ten minutes is
  telling you the architecture is bad, and its judgment is worth more than yours there because its
  context is not contaminated by why the thing is shaped that way.

## Prompts

[p-builder.md](p-builder.md) · [p-idea.md](p-idea.md) · [p-eyes.md](p-eyes.md) ·
[p-sdkfix.md](p-sdkfix.md)

Copy the prompt, fill its `<...>` slots, write it into the round's run dir, and send that filled
copy. Never send the template.
