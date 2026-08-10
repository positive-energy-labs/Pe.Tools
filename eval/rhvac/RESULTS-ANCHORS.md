# Sidecar v2 anchor results (P1)

Baseline: committed suspect-flag state `2fa634a`.

## Outcome

Sidecar v2 records each new decision with its detector label point and area:

```json
{
  "version": 2,
  "tsvSha256": { "Level 1/Main Level": "..." },
  "resolutions": [{
    "candidateKey": "Level 1/Main Level:R03",
    "flag": "open-plan-merge",
    "action": "accept",
    "anchor": { "label": [411.29, 821.38], "sqft": 1436.2 }
  }]
}
```

The TypeScript and C# consumers now use the same replay rule:

1. v1 sidecars use exact key matching only.
2. v2 exact keys apply only when the room contains the anchor and area remains within 20%.
3. Otherwise the decision remaps to the same-level polygon containing the anchor.
4. A decision with no target, missing v2 anchor, or unusable split is retained in the sidecar and counted orphaned.

The web queue reports the orphan count and badges provenance mismatch as `recorded against an older detection`. The C# candidate export runner prints `applied/remapped/orphaned` and emits an uppercase warning when orphans exist.

## Renumber-survival gate

Shared fixture: `eval/rhvac/fixtures/sidecar-anchor-remap.json`.

The fixture swaps `R01` and `R02` between detection runs, then replays two anchored decisions plus one deliberately unresolvable decision. Both mirrors produced the fixture's identical expected result:

- auto-remap: **2/2 resolvable decisions (100%)**; target was at least 95%
- applied by stale key: **0**
- orphaned and surfaced: **1**
- silent drops: **0** (`applied + remapped + orphaned = 3/3`)
- resolved rooms: `R01.a`, `R01.b`, `R02`; areas `200`, `200`, `100` sf

## Scorer proof

`score-takeoff.py --resolutions` now applies `accept` and `split` before scoring and writes a `RESOLUTIONS` block to text and JSON. A two-touch project-a smoke sidecar exercised both verbs:

```text
RESOLUTIONS
touches accept:1  split:1
applied 2  remapped 0  orphaned 0
before ratio 2.42  score 54.1
after  ratio 2.42  score 54.1
```

The synthetic split adds a small second polygon; the total candidate/GT ratio and mean-IoU score are unchanged at their displayed precision. A no-sidecar run also completed, preserving the committed scorer path.

## Proof lanes

- TypeScript targeted format/lint/type check: pass.
- Web full suite: **86 passed** across 16 files; RHVAC mirror: **15 passed**.
- Host RHVAC ops: **5 passed** with `PE_LANE=dev`, including deterministic v2 persistence and TSV SHA-256 projection.
- Source compile: `Pe.Revit.Takeoff` and `Pe.Revit.Tests` `Debug.R25.Tests` pass.
- FreshRevitProcess: full RHVAC gate **18 passed**, then the final sidecar-specific rerun **2 passed**, 0 failed, 0 skipped; Revit 2025, `NoRrdContact`.
- Python: compile pass; no-sidecar project-a score pass; accept+split sidecar score pass.

No detector or TSV output contract changed. No user-owned Revit/RRD session was contacted.
