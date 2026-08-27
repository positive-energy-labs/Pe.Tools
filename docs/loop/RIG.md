# The delegated convergence loop

A rig for an unattended, multi-agent push at a **measurable frontier**. You are the orchestrator.
**You never write code.** Everything that touches the tree is delegated.

The seed idea: **fan out on everything plausible at once, let the metric and the eye kill most of
it, keep the survivors, repeat.** A round that retires nothing and narrows nothing produced no
information. That is the failure mode this rig exists to avoid, and it is why builders go wide and
simultaneous instead of deep and sequential.

A builder is cheap and disposable. Reaching for the keyboard yourself is the expensive mistake: it
burns your context on implementation history, which is the contamination that makes you a worse
judge of the work.

This document is not an authority on your mission. It seeds the loop and names the traps. Read
`BRIEF`, `TASTE`, and `LEDGER` for what is true.

---

## Cast

| Role | Who | Edits code | Lives |
|---|---|---|---|
| **orchestrator** | you | never | the session kaitpw opened |
| **builders** `b1..bN` | Codex, reasoning **high** | own worktree only | one Herdr session per worktree |
| **idea** | Claude Opus 5, medium | never | standing session, spawned when dry |
| **eyes** | Claude Opus 5 — **fresh every time, never reused** | never | spawned per checkpoint, stopped after |
| **sdkfix** | Codex | SDK worktree only | standing session |

---

## Mission block — fill this in before Round 0

```
MISSION      one sentence, kaitpw-locked. What gets better, and the thing you may never do to get it.
BASE         <abs path to the base worktree>            BRANCH  <branch>
BRIEF        <the standing brief doc>                   TASTE   <the doc whose verdicts outrank the metric>
LEDGER       <docs/features/<name>/LEDGER.md — Decided / Tried & rejected / Owed>
CURRENCY     <exact command that prints the number, and which number it is>
SECONDARY    <the numbers that must be read on the same line as CURRENCY — see Gotchas>
GATES        <exact command(s) that must be green; the honesty bar no candidate may lower>
DECIDER      metric-first | checkpoint-visual | visual-first
VISUAL       <exact export command, expected panel set, and review cadence>
PLATEAU      <the numeric and visual dry rule that ends the mission>
BACKLOG      <where hypotheses come from today>
BIG_MOVE     <the metric delta that earns an image checkpoint>
FLAT_RULE    metric-only | eyes-can-carry   (eyes-can-carry: flat CURRENCY may adopt on a visual
             ADOPT if a NAMED secondary number moved; name it here)
WIDTH        <builders per round>                       TIMEBOX <minutes per builder per round>
AMBITION     knobs-first | code-first   (code-first: builders may restructure stages and models;
             gates and honesty bars stay untouchable)
RUNS         <abs dir where every round's artifacts land>
```

Anything not in that block is loop, and the loop does not change per mission.

`metric-first` means the metric adopts and the eye can veto at configured checkpoints.
`checkpoint-visual` means intermediate grafts are provisional until a delegated visual checkpoint
adopts the block. `visual-first` means every candidate needs a visual verdict before graft. Do not
compress visible quality into one scalar just to fill `CURRENCY`.

<details><summary>The filled block for the 2026-08-21 run (loop2) — an example, not a template</summary>

```
MISSION      Raise accepted coverage on project-a by making more geometry honestly pass the existing
             gates - never by loosening gates.
BASE         C:\Users\kaitp\source\repos\Pe.Tools-takeoff-frontier   BRANCH  takeoff-frontier
BRIEF        docs/features/takeoffs/TUNING.md                        TASTE   [TASTE.md](../features/takeoffs/TASTE.md)
LEDGER       docs/features/takeoffs/LEDGER.md
CURRENCY     python eval/rhvac/score-looks-good.py score <run>/report.json -> board v1.1 savedWork
SECONDARY    accepted rooms / accepted sf / residue ft, from the BOARD line. savedWork credits HELD
             area, so it moves without any product win. Never read it alone.
GATES        dotnet test source/Pe.Takeoff.Tests -c Debug (143 green), and no already-accepted room's
             edgeOnInk falls by more than 0.005
DECIDER      metric-first
VISUAL       compare-zone-runs.py; report-card zones at BIG_MOVE checkpoints
PLATEAU      dry reframe round after two dry rounds
BIG_MOVE     savedWork +0.010 cumulative since the last checkpoint
FLAT_RULE    eyes-can-carry; secondary = accepted double-line residue ft
WIDTH        3                                          TIMEBOX 60
AMBITION     code-first. No Revit: raster lane only.
RUNS         ...\.artifacts\runs\loop2\   baseline = ..\overnight-r7\report.json (savedWork 0.3736)
```

Result: 9 builder lanes, 3 rounds, 0 adopted, closed dry. Three mechanisms falsified. That is a
legal outcome of this rig, and the reason the `FALSIFIED` verdict below exists.
</details>

---

## Round 0 — establish the floor

Delegate it to one builder. It ends with: `BASE` green on GATES, one baseline run under `RUNS/r0/`,
the CURRENCY number recorded, and a committed tree. Read `BRIEF`, `TASTE`, and `LEDGER` yourself
while it runs — you need the tombstones. **Never re-try a tombstone without new evidence.**

If the baseline number disagrees with the docs, that is Round 0's real finding. Stop and say so; a
wrong baseline poisons every comparison after it.

Round 0 also owes:

- **Identity check.** Run the baseline twice, no-op. Ids, dispositions, and geometry must be
  byte-identical, or the per-unit honesty bar is undefined and every A/B is noise. If it fails, the
  first fan-out's top hypothesis is "make identity stable", not coverage.
- **Merge audit.** If `BASE` is behind `main`, the merge that brought it current is audited before
  any fan-out builds on it.
- **Taste closure.** Every open "FOR kaitpw" call from the last `SUMMARY.md` gets a TASTE line —
  kaitpw's answer, or a recorded default with the date. No fan-out runs over a coin flip.
- **Visual identity.** Generate the complete baseline bundle twice. The manifest, expected panel
  count, inputs, fit, and pixels must match. Missing or unreadable panels make the visual lane red.
- **Rubric calibration.** Name visible defects from concrete baseline examples. Do not invent a
  score yet. The reviewer needs defect names and precedence, not weights.

## Proof contract

- **GATES** prove legality and honesty. They never claim that an output looks good.
- **CURRENCY and SECONDARY** measure coverage, defect counts, and cost. They rank work and expose
  regressions. Keep the vector; do not hide disagreement in a weighted mean.
- **VISUAL** is the exact output under review. It includes every expected unit, not only changed or
  favorable units.
- Under `DECIDER = visual-first`, green gates plus a visual ADOPT are required. A metric gain alone
  cannot graft. Under `checkpoint-visual`, metrics may graft provisionally but no phase or baseline
  becomes final before a visual ADOPT. Under `metric-first`, the configured checkpoint can veto.

---

## Round N — fan out, harvest, verdict, graft

**1. Fan out.** Pick 3–5 hypotheses. Overreach deliberately on at least one; a slate pruned for
feasibility teaches nothing.

> **Each lane must name the SEAM it touches** — the one place in the system where its mechanism
> acts. **Reject a slate where two lanes name the same seam.** "Mutually exclusive in mechanism" is
> not self-enforcing: loop2 ran four lanes that all died at the same seam, and nobody saw it until
> the idea lane tabulated them after the fact.

Each builder gets its own worktree and its own Herdr session, or they collide on artifact paths:

```
git -C BASE worktree add ../<repo>-r<N>b<k> -b <branch>-r<N>b<k>
powershell -NoProfile -ExecutionPolicy Bypass -File <execute skill>\herdr-up.ps1 <mission>-r<N>b<k> <that worktree> b<k>:codex
powershell ... herdr-send.ps1 <mission>-r<N>b<k> b<k> <abs path to the filled p-builder.md>
```

Keep the `<repo>-r<N>b<k>` naming prefix — it is what makes bulk teardown safe next to worktrees you
did not create. Send all builders before waiting on any. Then background one waiter each.

**2. Harvest.** Each builder wrote `RUNS/r<N>b<k>/REPORT.md`. A builder that hits `TIMEBOX` writes
what it has (`Gates: NOT RUN` is a legal line); a timeboxed builder is a data point about cost.

> **Verify wins. Trust declared losses.** A pasted proof is a claim until you re-run it — re-run
> CURRENCY and GATES yourself for the candidate you intend to adopt. But a report whose own
> falsifier fired needs no re-verification. Re-scoring a self-declared loss costs a round and buys
> nothing.

**3. Verdict.** One per lane, at most one ADOPT per round:

| Verdict | When | Ticks the dry counter |
|---|---|---|
| **ADOPT** | the mission's DECIDER approved it, GATES green, honesty bar held | no |
| **FALSIFIED** | the lane's stated falsifier fired — the mechanism is now proven not to be the lever | **no** |
| **REJECT** | it regressed, or it produced no information | yes |

`FALSIFIED` is the verdict this rig was missing. A proof of absence is expensive, real, and reusable
— it retires a direction permanently. Counting it as dryness stops the frame exactly when it has
finally started to learn. Write the falsification into `LEDGER` as a tombstone with its evidence.

A tie with no gain is a REJECT. Then read the losers for parts: a rejected mechanism often carries
one idea that belongs in a winner. Name those — they are next round's fan-out.

**4. Graft.** Merge the winner into `BRANCH`. One dated `LEDGER` line per outcome. The winner is the
new baseline. Then tear down: **`herdr session stop <name>` FIRST** — the pane holds the directory
and `rm -rf` fails with a permission error that never mentions the session — then remove the
worktree, `git worktree prune`, delete the branch.

**5. Rewrite `RUNS/SUMMARY.md` every round, overwriting.** The morning read must always be current:
where the frontier is, what moved it, what is now dead, and open calls for kaitpw with your
recommended default for each.

Append one short line to `RUNS/TIMELINE.md` after every meaningful event:

```
<utc> | <phase/round> | <event> | <evidence path or commit>
```

Never rewrite it. Keep each field to one phrase so it survives a long session without becoming a
second report.

---

## Visual review

Under `DECIDER = visual-first`, every candidate that clears GATES gets a complete visual bundle and
a verdict before graft. Metrics decide review order, not adoption. The reviewer sees the frozen
rubric, manifest, and images, but never the hypothesis or builder narrative.

Under `DECIDER = checkpoint-visual`, do not summon eyes every wave. Generate a complete bundle and
use a fresh delegated reviewer at baseline calibration, a large cumulative metric move, a named
focused investigation, each phase boundary, and plateau. Intermediate grafts stay provisional; a
checkpoint REJECT unwinds the whole block to the last visually adopted baseline.

Under `DECIDER = metric-first`, deterministic gates run every round and the eye runs at checkpoints:

> Fire a checkpoint when cumulative adopted CURRENCY delta since the last checkpoint reaches
> `BIG_MOVE`, when a single adopted round exceeds the largest adopted delta so far, or **before
> graft** on any round whose delta is at least `BIG_MOVE / 2`. A big single jump is exactly when the
> metric is least trusted.

Under `FLAT_RULE = eyes-can-carry` a flat-CURRENCY candidate with green GATES, honesty held, and the
named secondary moved is **eligible**, not adopted: it earns a checkpoint of its own and adopts only
on that ADOPT. Flat plus nothing named is still a reject.

The whole fan-out **stops** until the verdict lands. Spawn a fresh `eyes` (a name never used
before), send it `p-eyes.md`, and let it see **only the panels and the comparison — never your
narrative, never the reports**. A stranger who knows nothing about why the change was made is the
only reviewer whose praise means anything. Stop the pane when the verdict is read.

The price of looking rarely: a REJECT unwinds the **whole block since the last checkpoint**. Record
every rolled-back mechanism with the reviewer's words verbatim, and treat the reviewer's complaint
as the top hypothesis of the next fan-out.

The visual bundle is red before judgment if any expected panel is absent, unreadable, stale, or
rendered with different inputs, crop, fit, or layers across A and B. The manifest records hashes for
all inputs and outputs. Preserve the exact reviewed export path in the verdict.

Use three views without confusing their jobs:

1. The contact sheet proves that every expected unit exists.
2. The focus atlas is the primary review surface. It contains a tight A/B crop for every changed
   boundary component and every flagged defect.
3. Full-unit panels provide context on demand. They do not replace focused review.

The manifest maps every changed component to at least one focus panel. A change with no focus panel
makes the bundle incomplete.

---

## When the fan-out goes dry

Two consecutive rounds where nothing adopts **and nothing was falsified** means the frame is wrong,
not that the builders were lazy.

Spawn `idea` with `p-idea.md`. It thinks; it never edits, never runs the solver, never commits. It
returns a ranked reframe: what the evidence says the real lever is, which lines it declares dead,
and what would change its mind. Rebuild the next fan-out from that report.

**If the reframed round also adopts nothing, test `PLATEAU`.** Stop only when its numeric and visual
conditions both hold. Stopping on a dry frontier is a result. Grinding out four more rejected
rounds is not.

---

## Gotchas

The ones that cost real time. Add to this list; it is the most valuable part of the file.

**The currency lies.** A score that credits work-in-progress, held, or deferred units moves without
any product win. Read CURRENCY next to `SECONDARY` on the same line, every time. In loop2 this
nearly adopted a change whose accepted geometry was byte-identical to baseline.

**Silence reads as success.** A comparison tool that emits zero panels when nothing changed, a test
wrapper that returns before the runner prints its summary, a diff tool that reports drift from noise
you do not care about — each has already fooled a builder into reporting a win. Name every one you
find in `p-builder.md` **before** the round, not after.

**Environment**

| Trap | Rule |
|---|---|
| Codex writes UTF-16 | `iconv -f UTF-16 -t UTF-8 <file> \|\| cat <file>`; tell builders to write UTF-8 |
| Worktree `rm -rf` → Permission denied | stop the Herdr session first |
| Terminal wrapper default is 10 s | one command per call; never chain scoring commands |
| Bash background cap is 600 s | a 60-min builder is this rig's supervisable maximum |
| `rg` + wildcard in an abs Windows path | os error 123 — use `rg -g "pat*" <dir>` |
| Unquoted heredoc | `<<'PYEOF'` always |
| `herdr` default session | pass `--session <S>` on **every** command; `agent list` is the only truthful health signal |

---

## Tooling defects — delegate, never fix, never block

**A defect named in any report must exist as a queue file first.** A defect described in prose and
never filed is a defect nobody is working on.

Write `<queue dir>/<NN>-<slug>.md`: the problem in two sentences, the exact repro with tee'd output
paths, the expected behavior. Send it to `sdkfix`. Continue the round with a workaround. `sdkfix`
owns reproduce → fix → gate → release → re-pin and drops `<NN>-<slug>.done.md` beside your file.

---

## Rules that do not bend

- Never touch the main checkout (kaitpw's uncommitted work lives there) except to **read** skills
  and **run** the `herdr-*.ps1` scripts.
- Never `git add -A`, never `commit -a`. Commit by pathspec.
- Never loosen a gate constant, threshold, or honesty bar to make a candidate pass.
- Never leave an unadopted diff in a tree. Reject means revert, now.
- Never reuse an `eyes`. Never let a builder decide adoption. Never implement anything yourself.
- Every round boundary leaves a committed tree and a written report, so a crash costs one round.
- Verdicts that matter to kaitpw go in `LEDGER` — not in commit messages, not only in `SUMMARY.md`.
- Time on task that felt wrong is signal. A subagent grinding for an hour on a ten-minute job is
  telling you the architecture is bad, and its judgment beats yours there because its context is not
  contaminated by why the thing is shaped that way.

## Prompts

[p-builder.md](p-builder.md) · [p-idea.md](p-idea.md) · [p-eyes.md](p-eyes.md) ·
[p-sdkfix.md](p-sdkfix.md)

Fill the `<...>` slots, write the filled copy into the round's run dir, send that. Never send the
template. Assert no `<SLOT>` token survives — an unfilled slot has already shipped once.
