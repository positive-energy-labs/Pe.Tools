# Role-labelling brief (for cheap subagents)

Read-only analysis. Write nothing except your own output file. Roles are inferred after the fact from the record; you are not asking any agent about itself, and you never claim more than the shard shows.

## Input

`<run-dir>/shards/<lane>/<nn>.md`: one epoch of one top-level lane (an agent thread the owner talked to, or the root of a tree). The header lists window (UTC), models and efforts, spend, tool-class mix, flags (test runs, browser, pe-revit, git deletions, commit commands), commits own and by exclusive descendants (+ins/-del, modules), messages in and out (which lanes), checkpoint debt, inflow from direct children, and `owner flow` (where the owner went before and after). The body is OWNER TURN blocks (the human's own words, highest signal) each preceded by the final reply it answered, then other final replies, and `relay` blocks. A relay is agent text sent up through the user role. It is not the owner; never cite it as the owner.

## Batching

- Sort shards by size (`ls -S`) and deal them round-robin so each batch holds about 12 to 20 shards or about 250 KB. Never split one lane across batches: label a lane's epochs together so drift is visible.
- One subagent per batch; the cheapest model that reads long text is enough. Run batches in parallel, then merge.
- Thin shards (under ~8 events, no owner text) get `confidence: low`; do not guess.

## Role vocabulary (the owner's)

- `implementor`: writes product code itself; its own commits and edits dominate.
- `purger`: deletes tests and dead code, hunts churn-causing architecture, lowers LOC.
- `driver`: drives the product at its surface (browser, Revit, Pea), finds defects, files them to others; writes no tests.
- `architect/muse`: high-level re-architecture with the owner, synthesizes other agents' expertise, writes plans and ADRs.
- `meta-manager`: keepalive, nudges and monitors other agents, fixes systemic inefficiency of the agent network.
- `integrator/orchestrator`: merges branches, sequences waves, dispatches child agents, owns a merge train or gate.
- `resource archivist`: gathers and curates reference resources (docs, videos, external material).
- `one-off`: a side question roped into the loop.
- `other:<name>`: anything else, named in a word or two (for example `other:auditor`, `other:retro-analyst`).

A lane may play two roles in one epoch: give `role` (primary) and an optional `secondary`.

Also capture the SWITCH signal: if the owner's turns show frustration, re-tasking, or "move this to X", or `owner flow` shows the owner left and did not return, write one line on why, quoting the owner. If none, write an empty string.

## Output: strict JSONL, UTF-8, one object per line, EXACTLY these keys

One line per epoch:

```
{"lane": "<shard dir name>", "epoch": <int>, "role": "<primary>", "secondary": "<role or empty>", "confidence": "high|med|low",
 "evidence": "<=200 chars, concrete, quote the owner if possible>", "evidence_ts": "<UTC ISO timestamp of the owner turn or reply you cite>",
 "switch": "<=200 chars or empty>", "switch_ts": "<ts or empty>"}
```

Then ONE extra line per lane (epoch 0):

```
{"lane": "<shard dir name>", "epoch": 0, "lane_summary": "<=400 chars: what this agent was for over its life, how its role drifted, who it worked with>",
 "notable_owner_corrections": ["<=150 chars each, with ts>", "... up to 5"]}
```

Rules: every `evidence` must be traceable to a timestamp in the shard. Do not invent. `lane` is the shard directory name (the lane's short id) and `epoch` the file number as an integer (`03.md` is `3`). Final chat reply under 150 words: output path, lines written, anything surprising.

## Merge into roles.json

```
python .agents/skills/slot.mine/scripts/corpus/merge_labels.py --out <run-dir>/roles.json --epochs <run-dir>/epochs.json <batch>.jsonl ...
python .agents/skills/slot.mine/scripts/corpus/render.py --run <run-dir> --roles <run-dir>/roles.json
```

`roles.json` is `{ "<lane short id>": { "<epoch n as a string>": "<role>", "*": "<optional lane default>" } }`; a lane or epoch absent from it renders as unlabelled grey. `merge_labels.py` writes `roles.detail.json` beside it (evidence, secondary, confidence, switch, lane summary), which the epoch side panel shows. A later batch overrides an earlier one for the same lane and epoch and the override is printed; a lane or epoch the run does not have is dropped and printed. Epoch numbers belong to one run: after a rerun that changes epochs, carry labels with `--remap-roles <old roles.json> --remap-from <old epochs.json> --epochs <new epochs.json>` instead of relabelling.
