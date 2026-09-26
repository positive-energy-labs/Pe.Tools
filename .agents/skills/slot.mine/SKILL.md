---
name: mine
description: Mine retained Claude and Codex sessions into evidence. Trigger on "mine session history", "scrape my past sessions", "history mining", "session census", "mine Claude and Codex", or when prior prompts, tool friction, failures, or skill usage must be inferred across sessions. Not for searching repo source or recalling one known session.
figure: how retained Claude and Codex sessions become evidence, this repo
prevents: "rumor: a finding without lineage"
scope: repo
---

# Mine

**Be the Archivist.** Freeze the collection before interpreting it. A finding without lineage is rumor; a report that cannot be replayed is a story about evidence, not evidence.

**Be the Genealogist.** Sessions fork, clients mirror, and `role=user` can contain agent prose. Count independent human acts, not storage descendants.

Extraction establishes evidence. Interpretation never rewrites it. Never turn a keyword count into a requirement count.

## Corpus

Run from the checkout root:

```powershell
python .agents/skills/slot.mine/scripts/extract_sessions.py --out .artifacts/runs/deterministic-YYYYMMDD-<slug> [--since YYYY-MM-DD] [--exclude-session <id>]
```

The extractor streams canonical Claude CLI and Codex rollout stores, reconciles TUI/Desktop/T3 projections, and prints aggregates only. One self-contained run holds:

| Artifact | Contract |
|---|---|
| `inventory.json` | command, extractor hash, input file signatures and drift, window, exclusions, errors, and retention caveats |
| `sessions.jsonl` | provider/client session metadata, including T3 title, model, provider ids, and join confidence |
| `turns.jsonl` | canonical authored turns and the lineage of every collapsed projection or fork copy |
| `candidates.jsonl` | every task-local classification and exclusion decision; produced by the task-local classifier |

Keep the task-local classifier and its full candidate ledger in the dated run directory, never `.artifacts/tmp`. Synthesis consumes that frozen ledger.

For command failure rates, timeouts, and blind retries, use `python tools/loop-metrics.py --since YYYY-MM-DD --out <run-dir>/loop-metrics`; its structured result classifier is the authority. For assistant behavior such as skill invocation, write a small task-local streaming extractor in the run directory against the canonical stores. Keep that task logic out of `extract_sessions.py`.

## Laws

- Freeze scope first: stores, date window, clients, root versus subagent turns, and the active sessions excluded from the result.
- Count canonical authored turns. Treat TUI, Desktop, and T3 rows as projections until reconciliation proves that a row exists only there.
- Exclude tool results, meta records, injected instructions, system notifications, continuations, sidechains, subagents, and the mining request itself.
- `role=user` is a storage role, not proof of human authorship. Mark dispatch briefs, filed tasks, and agent-written missions `authorship: uncertain`; exclude them from conviction counts only after adjudication.
- Hash the full normalized text. Never deduplicate on a prefix. Collapse storage copies and fork copies; preserve a repeated authored statement at a different time.
- Extract task candidates with sentence- or clause-local rules. A topic match in one paragraph cannot lend intent to another paragraph.
- Serialize every candidate with provider, client, session, timestamp, path, locator, hash, and exclusion reason where applicable. Do not emit only the top results.
- A recurrence claim requires a story ledger listing its independent authored submissions. Topic counts, provider spread, and projection copies never prove recurrence.
- Verify provenance by rereading the canonical record and checking authorship plus the complete paraphrased meaning. Keyword presence is not verification.
- Review candidates semantically. Rank current constitutional verdicts, direct failures, and committed outcomes above capability probes, hypotheses, and frequency.
- When review is sharded, adjudicate one shared calibration sample first, preserve disagreement, review full local context, and send the synthesis through a clean critic. Clip only report excerpts.
- Keep owners separate. Product requirements, SDK contracts, harness preferences, and research-method corrections do not share a backlog because they share words.
- Never print raw session text to the terminal or chat. Raw text stays in the local run artifact; reports use short verified excerpts or provenance pointers.
- Report counts as candidate floors with overlapping forms. State retention limits, projection-only coverage, parse/read errors, and what semantic completeness remains unproven. The earliest surviving transcript is a retention boundary, never the start of history.

## Stop

Stop only when the run is self-contained, source drift is disclosed, every synthesis claim resolves to candidate and authored-turn rows, every recurrence claim resolves to a story ledger, and remaining semantic or retention gaps are stamped `UNPROVEN`. A reusable method change belongs here; a task result stays in its dated run directory unless `docs` promotes a durable verdict.
