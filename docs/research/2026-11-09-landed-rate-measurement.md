# Landed-rate measurement: numbers, method, exclusions

Date: 2026-11-09. Source: `main` at `ec3a13a88879e83dcd722aba16f440c92da5d24c`, T3 project `72b0f376-b12f-4c40-adf9-afd856c8d944`, window 2026-10-26 00:00 to 2026-11-09 23:59:59 local (UTC `2026-10-26T05:00Z` to `2026-11-10T05:59:59Z`).

This note keeps the decisive numbers of the retro-measurement fix, so they outlive the gitignored run directories `.artifacts/runs/retro-20261108-landed14/` and `.artifacts/runs/retro-20261109-topology/`. Git does not archive those directories. A reader needs only this note to restate the numbers, the method, and what they cannot say.

No model ranking follows from any number here. Cells are small, `unknown` is 15% to 60% of several cells, and the grain changed between the old and new method.

## Why the old numbers were wrong

1. The old `census2.py` marked a thread "merged" only if its branch was an ancestor of `main`. A branch that the owner deleted counted as "unmerged". The owner deletes worktrees and branches as normal practice, so branch existence is not provenance.
2. Ancestry also misses landings by rebase, cherry-pick, and squash.
3. "Owner turns" counted every user-role message (861). 86 of those are server-sourced rows, which are agent text sent from a child thread to its parent.
4. "Weak attribution is 35.1%" measured commits. Weak (first-mention) commits are larger, so they hold more of the code that survives. The mass-weighted share is 52.1%.

## Landed ladder (390 branch-threads)

Universe: 1,367 threads in `census2.json`. 390 have a branch. Excluded: 941 main-direct threads (no branch by design) and 36 threads with no recorded branch. Method: `classify` in `.agents/skills/slot.mine/scripts/landed.py`. State is `landed`, `open`, or `unknown`. A branch that is absent from refs is never `open`: it is `landed` on positive evidence, else `unknown`. `unknown` is not a failure.

| State | Threads | Share of 390 |
|---|---|---|
| landed, strong | 233 | 0.60 |
| landed, weak | 24 | +0.06 (0.66 with strong) |
| open (branch kept, own commit, not on `main`) | 27 | 0.07 |
| unknown, branch gone | 44 | |
| unknown, empty tip (branch tip is not newer than the thread: it made no commit there) | 62 | |
| unknown, total | 106 | 0.27 |

Report the rate as a ladder: strong 233/390, strong+weak 257/390, strong+weak+unknown 363/390. Never report one rate.

Evidence behind the 257 landed (first hit wins): `commit-line` 138, `cherry-all` 38, `patch-id` 28, `branch-ancestor` 27, `first-mention` 19, `merge-subject-partial` 5, `merge-subject` 2. 166 of the 257 rest on `commit-line` or `patch-id`, which need a transcript. About one third of threads have no transcript.

Old to new, on the same 390 threads:

| Old verdict | Count | New verdict |
|---|---|---|
| merged | 225 | 163 landed, 62 unknown (empty tip) |
| unmerged | 165 | 94 landed, 27 open, 44 unknown (branch gone) |

82 of the 165 old "unmerged" threads had a branch absent from refs. 46 of the 83 whose branch still exists are fully patch-equivalent on `main`.

By model (rates: strong, strong+weak, strong+weak+unknown). Do not compare rows.

| Model | n | strong | weak | open | gone | empty | strong | +weak | +unknown |
|---|---|---|---|---|---|---|---|---|---|
| gpt-6.1-sol | 261 | 187 | 6 | 13 | 22 | 33 | 0.72 | 0.74 | 0.95 |
| claude-opus-5-5 | 79 | 25 | 15 | 9 | 11 | 19 | 0.32 | 0.51 | 0.89 |
| gpt-6-astra | 17 | 9 | 1 | 1 | 6 | 0 | 0.53 | 0.59 | 0.94 |
| claude-fable-5-1 | 15 | 3 | 1 | 1 | 1 | 9 | 0.20 | 0.27 | 0.93 |
| claude-sonnet-5-5 | 9 | 3 | 1 | 2 | 2 | 1 | 0.33 | 0.44 | 0.78 |
| gpt-6.1-terra | 5 | 2 | 0 | 1 | 2 | 0 | 0.40 | 0.40 | 0.80 |
| gpt-6-luna | 4 | 4 | 0 | 0 | 0 | 0 | 1.00 | 1.00 | 1.00 |

The old claim "gpt-6-astra landed 0 of 17" is not supportable. The new reading is 9 strong, 1 weak, 1 open, 6 unknown. That corrects the measurement. It says nothing about the model.

## Denominators

| Figure | Published | Fixed | Method |
|---|---|---|---|
| Owner turns | 861 | 775 (735 web, 40 mobile) | `owner_turn` in `landed.py`: `createdBy=user` AND `creationSource` is `web` or `mobile`. The 86 server rows are agent text; 77 sit in delegated-task pseudo-threads. Inflation 11.1%. |
| Weak attribution | 35.1% of commits (696 of 1,981 non-merge commits) | 52.1% of survival-line mass (189,897 of 364,798 lines) | `survival.json`: `git blame` at head over files touched in the window. Strong (`commit-line` + `patch-id`) is 47.9%. Overall survival 193,531 of 364,798 (53.1%). |
| Live-DB owner turns in the census threads and window | 855 (old `retro.py` OR-predicate), 824 (old sensor) | 734 (AND-predicate) | Differs from 775 because the universe differs. Inferred, not reconciled. |

Survival by attribution method, pooled: `commit-line` 0.534, `patch-id` 0.384, `first-mention` 0.542. No visible bias, but this does not license per-model cuts. Strong-only survival per model was not recomputed.

First-mention accuracy: hiding the 1,193 commit-line commits and re-attributing gives the same thread 975 times (81.7%) and the same root 1,094 times (91.7%). It is good at root level and weak at child-thread level.

## Census counts are unreconciled

Five counts of the same window disagree: 2,394 (sensor), 2,409 (REPORT), 2,412 and 2,447 (one intent, two `--until` spellings), 2,418 (recount). Re-run on 2026-11-09 against `main`:

- `git rev-list --count main --since=2026-10-26T05:00:00Z --until=2026-11-10` gives 2,447 commits, 1,981 without merges (466 merges). This matches the topology run.
- `--since=2026-10-26` (bare date) gives 2,410 and 1,948 without merges.

So the spelling of a window bound alone moves the count by up to 37. Use explicit UTC instants. The cause of 2,394, 2,409, 2,418 was not found. Do not quote a commit rate without printing total commits, merges, and commits with no included files beside it. The corpus `commits` stage and its `coverage.txt` print that header (promoted from the retired `churn.py`).

## Provenance going forward

`T3-Thread` trailers on `main`: 0 of 5,700 commits. The trailer tier of `landed.py` is empty until agents write the trailer. The commit rule is in `AGENTS.md` (Always, item 8) and the `lens.delegate` child-brief line. The reader side (`facts` parses `%(trailers:key=T3-Thread)`; trailer beats every other evidence) and its precedence are in the `landed.py` header. Git reads trailers only from the last paragraph of the message, so `T3-Thread:` and `Co-Authored-By:` must share one block; use `git commit --trailer`. Fixtures: `test_landed.py` (trailer beats a deleted squash branch; trailers isolate by thread).

`T3CODE_THREAD_ID` was verified in one Claude session only. Codex threads are unverified. A `prepare-commit-msg` hook that adds the trailer was considered and not adopted; it needs an owner ruling after one window of trailer coverage.

Cannot be recovered for old commits: the 106 `unknown` threads. The only lever is the trailer. Checkpoint refs (`refs/t3/...`, 12,725) were not used. 95 of the 106 have one, 3 would flip, and the checkpoint-parent meaning is unverified.

## Cheap checks run 2026-11-09 (no LLM rating)

Scripts were scratch-only. Numbers are the retained record.

- **Ledger links.** `git ls-files docs .agents/skills/LEDGER.md`, content at `HEAD`: 163 files, 589 lines carry a `.artifacts/` path (64 files). 384 point into `runs/`, 43 into `handoffs/`, 29 into `tmp/`. 109 lines name a concrete path that is absent from the working tree today (36 more are templates with `<` or `*`). A 20-line manual read by one rater: 8 carry the decisive fact in the line, 6 depend on the link for their evidence, 4 are procedure or path conventions, 2 unreadable. Large link users: `docs/research/analysis-pilot-20261104-boundaries.md` (46), `docs/features/design-system/LEDGER.md` (55), `docs/features/host/LEDGER.md` (53).
- **Stamp lanes.** In 6,270 final replies (topology `events.jsonl`), 2,621 hold a `PROVEN[` stamp; 3,841 stamps in all. First token is in the closed table of `slot.execute` (plus `visual`): 2,223. Outside it: 1,618 (42.1%), mostly `source`, `static`, `source read`, `liveness`, `fixture`. 0 unclosed. 2,067 (53.8%) carry fewer than four fields, which `lens.prove` calls void. Lane vocabulary was not closed when these replies were written.
- **Reply length around 2026-11-03** (cut at 2026-11-03 00:00 CST). Final replies whose run also carries a `web` or `mobile` owner turn, words outside fenced code: before 395 replies, median 284 words, 23.0% over 500, 6.40 characters per word; after 298 replies, median 286.5, 18.8% over 500, 6.38. Opus 217 → 202 replies, median 340 → 324; Sol 41 → 49, median 93 → 109 (8.1 → 8.4 characters per word). Almost no change in the median. Confounds: workload and task mix changed; the owner's complaints anchored which windows were read; replies were not rated for quality; model mix shifted; one thread may supply several replies.
- **`reply_scan.py`** (retired 2026-11-09, lexical tone flags unwanted; advisory baseline, uncalibrated English lexical flags): all 6,270 final replies: `over_500` 6.3%, `missing_proven` 24.3%, `outcome_not_first` 52.0%, `ultra_compressed` 20.6%. First 500 completed assistant messages of `statev2.sqlite` by message id (oldest, not a random sample): 5.4%, 21.0%, 55.4%, 0.4%. Flags overlap. Do not use as a gate.

## Not run

The replay of the correction-prone prompts with an LLM rater, and the A/B of figured against plain skill text, were not run. They need a pre-registered criterion and cost ceiling.

## Retained and deleted

Kept in `.artifacts/runs/retro-20261108-landed14/` until the owner says otherwise: `REPORT.md`, `census2.json`, `retro.json`, `sensors/` (sources of the retired `inflow.py` and `churn.py`, since folded into `scripts/corpus/`: checkpoint debt in `common.py`, module retouch and co-change in `stage_survival.py`). Deleted as dead (2026-11-09): the first `census.py` (the later `census.py`, `inflow.py`, `churn.py` and `reply_scan.py` were folded into `scripts/corpus/` or dropped the same day), `census2.py`, `calc_merged.py`, `stability.py`, `tone.py`, `exp/` scorers and recounts, `probe_*.py`. One lesson line from each: the lexical tone mirror measures the register it is told to find; the by-model task-type table in `stability.py` rested on a regex taxonomy that `REPORT.md` calls unusable.
