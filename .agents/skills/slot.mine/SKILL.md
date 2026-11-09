---
name: mine
description: Mine retained Claude and Codex sessions into evidence, from one named thread to the whole corpus. Trigger on "mine this thread", "catch me up on", "mine session history", "scrape my past sessions", "history mining", "session census", "mine Claude and Codex", or when prior prompts, tool friction, failures, or skill usage must be inferred across sessions. Not for searching repo source.
figure: how retained Claude and Codex sessions become evidence, this repo
prevents: "rumor: a finding without lineage"
scope: repo
---

# Mine

**Be the Registrar.** Freeze the collection before you interpret it. Do not report a finding you cannot trace to its record, and do not hand over a report that nobody can replay.

**Be the Genealogist.** Sessions fork, clients mirror each other, and `role=user` can hold agent prose. Do not count storage descendants: count independent human acts.

Extraction establishes the evidence, and interpretation never rewrites it. Never turn a keyword count into a requirement count.

## Verbs

There are three verbs, smallest first, plus the session extractor. Most asks name one to three threads. `corpus` is the rare one.

| Verb | Input | Writes |
|---|---|---|
| `thread` | T3 thread ids | rulings, landings, owed lines, and steers with their item ids, stated in chat so the reader never opens the thread; raw extracts stay in the run directory |
| `retro` | T3 thread ids | `retro.json` and `retro.html`: hours, owner turns, API calls, compactions, max context, cost, tool calls, tool output by tool, inflows over 20k characters, the context curve; cost is a floor when descendants exist (`cost_is_floor`) |
| `corpus` | a T3 project and two UTC instants | one command, one run directory: events, threads, lanes, epochs and shards, commits with attribution method and landed state, survival and a module table, and `retro.html` |

`thread` reads through the T3 thread tools (`t3_thread_read` messages and activity views, paged by item id) and `t3_thread_search`. It never pastes a thread into the reader's context. `retro` runs:

```powershell
python .agents/skills/slot.mine/scripts/retro.py --out .artifacts/runs/retro-YYYYMMDD-<slug> <thread-id-prefix>...
```

`retro.py` resolves each thread to its native Claude session or Codex rollout through T3's state database. It counts the main thread only, and it prices tokens from T3's model rates. An unpriced model gets an empty cost, never a zero. T3 search is bounded, so a count drawn from it is a floor. The landed figure is a ladder (strong, then +weak, then +unknown). Unknown is never a failure, and a deleted branch is `unknown`, not unmerged.

`corpus` runs from the checkout root:

```powershell
python .agents/skills/slot.mine/scripts/corpus/run.py --project <t3-project-id> --since <UTC instant> --until <UTC instant> --out .artifacts/runs/retro-YYYYMMDD-<slug>
```

- Bounds are explicit UTC instants. A bare date means 00:00Z. `since` is inclusive and `until` is exclusive, and every output echoes both.
- The stages `t3,native,commits,epochs,survival,samples,page` each write their artifact to the run directory, so `--stages` reruns one stage.
- An owner turn is `landed.owner_turn` (createdBy user, with source web or mobile). Agent text relayed through the user role is `relay`.
- Commit attribution tries trailer, commit line, patch-id, then first mention (weak), and prints coverage by commits and by lines.
- Never ask agents for their roles. A separate labelling loop (`pass.retro`, `corpus/label_brief.md`) writes `roles.json`, and `render.py --run <dir> --roles roles.json` re-renders the page.
- `corpus/run.py --help` gives the stage contracts.

For the retained Claude and Codex session stores, run from the checkout root:

```powershell
python .agents/skills/slot.mine/scripts/extract_sessions.py --out .artifacts/runs/deterministic-YYYYMMDD-<slug> [--since YYYY-MM-DD] [--exclude-session <id>]
```

The extractor streams the canonical Claude CLI and Codex rollout stores, reconciles the TUI, Desktop and T3 projections, and prints aggregates only. One self-contained run holds:

| Artifact | Contract |
|---|---|
| `inventory.json` | command, extractor hash, input file signatures and drift, window, exclusions, errors, and retention caveats |
| `sessions.jsonl` | provider/client session metadata, including T3 title, model, provider ids, and join confidence |
| `turns.jsonl` | canonical authored turns and the lineage of every collapsed projection or fork copy |
| `candidates.jsonl` | every task-local classification and exclusion decision; produced by the task-local classifier |

Keep the task-local classifier and its full candidate list in the dated run directory, never in `.artifacts/tmp`. Synthesis reads that frozen list.

For command failure rates, timeouts and blind retries, run `python tools/loop-metrics.py --since YYYY-MM-DD --out <run-dir>/loop-metrics`. Its structured result classifier is the authority. For assistant behavior such as skill invocation, write a small streaming extractor in the run directory against the canonical stores. Keep that task logic out of `extract_sessions.py`.

## Laws

- Freeze the scope first: stores, date window, clients, root versus subagent turns, and the active sessions you exclude.
- Count canonical authored turns. Treat TUI, Desktop and T3 rows as projections until reconciliation proves a row exists only there.
- Exclude tool results, meta records, injected instructions, system notifications, continuations, sidechains, subagents, and the mining request itself.
- `role=user` is a storage role, not proof that a human wrote the text. Mark dispatch briefs, filed tasks and agent-written missions `authorship: uncertain`. Exclude them from conviction counts only after you adjudicate them.
- Hash the full normalized text, and never deduplicate on a prefix. Collapse storage copies and fork copies, but keep a repeated authored statement made at a different time.
- Extract task candidates with rules local to one sentence or clause. A topic match in one paragraph cannot lend intent to another paragraph.
- Write every candidate with its provider, client, session, timestamp, path, locator, hash, and exclusion reason where one applies. Do not write only the top results.
- A recurrence claim needs a story list of its independent authored submissions. Topic counts, provider spread and projection copies never prove recurrence.
- Verify provenance by rereading the canonical record and checking both the authorship and the full paraphrased meaning. A keyword match is not verification.
- Review candidates by meaning. Rank current owner verdicts, direct failures and committed outcomes above capability probes, hypotheses and frequency.
- When review is split across agents, adjudicate one shared calibration sample first, keep their disagreements, review the full local context, and send the synthesis to a critic who did not do the review. Clip only report excerpts.
- Keep owners separate. Product requirements, SDK contracts, harness preferences and research-method corrections do not share a backlog because they share words.
- Never print raw session text to the terminal or chat. Raw text stays in the local run artifact. Reports use short verified excerpts or provenance pointers.
- Report counts as candidate floors with overlapping forms. State the retention limits, projection-only coverage, parse and read errors, and which semantic completeness remains unproven. The earliest surviving transcript is a retention boundary, never the start of history.

## Stop

Stop when the run is self-contained, source drift is disclosed, every synthesis claim resolves to candidate and authored-turn rows, every recurrence claim resolves to a story list, and the remaining semantic or retention gaps are stamped `UNPROVEN`. A reusable change to the method belongs in this file. A task result stays in its dated run directory unless `docs` promotes a durable verdict.
