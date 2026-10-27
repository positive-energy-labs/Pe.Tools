# Ducts black-box history, 2026-10-26

The useful cases are two different plenums. The SA 29 case reaches a shared plenum through equipment. The MUAS-1 / FC-23 case uses the separate FA 12 plenum. Do not combine their element ids or conclusions.

## Cases to replay

| Case | Prior prompt | Evidence and expected check |
|---|---|---|
| SA 29 and shared plenum | No retained historical SA 29 prompt was found before this task. Suggested probe: `look at SA 29, something is weird where all those systems meet` | Saved Project A group `g6494977` has SA 29, 67 elements, three terminals, and roots `6404587` and `14640567`. Root `14640567` also touches `g6293931`, the 302-element group containing plenum `6530455` and eight names: EX 88, FA 24/32/36/42, RA 1/26 and SA 71. First check whether Pea follows the equipment to that shared network. [Snapshot extraction](../../../.artifacts/runs/deterministic-20261026-duct-history/snapshot-cases.json). |
| FA 12 plenum | `@Ducts what is the deal this plenum` | Claude `7333e689-af70-49cb-9a8a-5a6096de151f`, line 3, and Codex `rollout-2026-10-23T15-24-03-01a16a6f-530e-7701-b33f-490da579bae3`, line 10. Selected duct `9883448`; louver `9883285`; open transition `10338169`. Codex identified the disconnected louver. Claude described the open end but missed that nearby louver. Both stopped without a model change. |
| MUAS-1 to FC-23 | `hey can u look at the makeup air for MUAS-1 in [Project A], i think it goes up thru the attic and comes back down to the air handler FC-23 but im not sure where the intake actually is` | Claude `02f23a59-a13a-4244-8962-cecdbc1f03f6`, line 4. MUAS-1 `14577391` reaches New Construction FC-23 `13760867`; second FC-23 `8732550` is Future phase. Pea initially missed the intake, then corrected itself after reading earlier Work. This exposes contamination from saved proposals. |
| EX 37 no-run | `why is this run a "no run"` | Claude `7a6e1987-4839-41ad-9bae-a1f49ea325e7`, line 4. Selected duct `10117479`; branch ends at ERV `6114189`, open duct `10796485`, and 25-cfm grille `10796114` on EX 32. Pea diagnosed foreign-terminal/open-end causes but did not repair or rerun the route calculation. |
| SA 19 versus FC-23 ambiguity | `how bad is sa 19 and the one with the muas one and i think its fc-23` | Claude `c2ff4078-609e-4f44-ba14-81a84c84c446`, line 169. Pea should distinguish the two cases. Prior demo history places FC-23 on SA 20, not SA 19. |

Full verified prompt and response candidates carry canonical path, line, timestamp and full-text hash in [candidates.jsonl](../../../.artifacts/runs/deterministic-20261026-duct-history/candidates.jsonl). Human authorship remains uncertain for the scripted demo prompts; they are test inputs, not independent human requirements.

## What the earlier runs actually established

[PDROP Demo Fixes: SA19 & MUAS1-FC23](t3-thread://v1/bed2b755-5c55-4d0c-be40-72deaac6aebb), items at positions 86, 100 and 205, contains explicit corrections that matter when grading a new run. SA 19 did have Revit flows despite an initial claim that it did not. The earlier run reported 0.186 / 0.060 in-wg. The later run returned zeros because its default `PE_M_Grd_AirFlow` covered none of the nine SA 19 grilles, while `Actual Supply Air Flow` covered all nine. A later MUAS run was killed by a host restart from concurrent edits, so it is not a repair failure verdict.

The MUAS run at Claude `1ab82172-d419-4352-81bf-ba4bbb7f3543`, line 346, explicitly said it made no fixes. It found no accepted design flow, reversed unit connector directions, the intake gap, ERV takeoffs, absent component drops, unreadable Work and missing document binding. Its 0.226 in-wg group result was the return-grille path, not the MUAS path. The engineer's R10 total 0.193 includes a typed 0.15 allowance; the duct-and-fitting comparison target was approximately 0.043. Those values are historical testimony and require fresh confirmation before use as acceptance targets.

[Synthesized Revit views for AI 3D modeling](t3-thread://v1/eeda6984-bfa8-43fc-b2f0-867006a0b3e4), position 52, reports that the plenum twins received 55×56 and 96×97-pixel crops while the capture text reported the pre-crop width. It also records `no mounted ducts view` despite the @-mention and selection. These are separate failures of shared attention and picture delivery. A headless prompt without the mounted route is a narrower test than the user's selected-view prompt.

[Multi-System Rendering for /ducts Viewport](t3-thread://v1/6e8d2a25-fdec-4f45-bdea-a8e107ac1292), item `turn-item:provider:claudeAgent:native-item:58e1bda1-a964-4864-8e60-87438394dbb8`, identifies plenum `6530455` as part of the whole shared group `g6293931`. Opening one system already included all eight system names in that group. Merely seeing several names is not proof of an erroneous merge.

## Repair grading

Use a second crude turn such as `ok fix what you can then show me what is still wrong`. Preserve the first response before adding context. Grade identification, proposed repair, actual mutation, and independent readback separately. A proposal or permission refusal proves no model repair. An unavailable mounted view must be recorded before attributing an attention failure to reasoning. Do not accept zero pressure drop as a real result when flow coverage is absent. Do not change the intended air distribution or invent equipment losses to make a test pass.

## Evidence boundary

The extraction searched Claude's Pea working-directory store and October Codex sessions whose cwd was the Pea working directory, changed since October 18. It excluded records at or after this task began at 2026-10-26 22:41 UTC. Twelve files contributed 59 keyword candidates, with zero source drift during extraction. This is bounded discovery, not an exhaustive corpus or a count of independent requests. Tool outputs and injected skill text are excluded from requirement candidates. T3 search omits subagent threads and may omit older matches.

PROVEN[deterministic, retained prompt records and saved Project A snapshot extraction, checkout 0b40c293, 2026-10-26]. This proves the retained inputs and saved snapshot relationships. UNPROVEN[current native topology, whether the old defects remain, and successful repair]. No runtime calls or model mutations were made by this history pass.
