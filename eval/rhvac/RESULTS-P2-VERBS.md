# P2 resolution verbs results (2026-08-06)

## Outcome

P2 is complete. Sidecar v2 now supports `reject` and `merge` alongside `accept`
and `split`, with the same source/target anchor remapping and loss accounting in
the TypeScript, C#, and Python apply mirrors. The detector was not changed.

- `reject`: C# and Python omit the room from export/scoring. TypeScript retains
  the polygon with `rejected: true`; the plan renders it gray at low opacity and
  removes its flags from the pending queue.
- `merge`: the `other` candidate survives, absorbs the source polygon, and gets
  `mergedFrom` provenance. Both candidate anchors must resolve; any missing
  source/target or non-adjacent union is one orphaned decision.
- C# directory replay now applies resolutions to raw detector polygons before
  simplifying the resolved shapes. This preserves the exact shared boundary a
  merge needs.
- The flag queue has one-touch reject and a `merge into...` mode that completes
  by clicking the survivor polygon.

The shared rank-shuffle fixture covers all four verbs, source and merge-target
anchors, remaps, and source/target orphans. A committed project-a Main sidecar uses
one of every verb and asserts 81 resolved rooms plus split/merge areas through
`RhvacCandidateBuilder.ParseTsvDirectory`.

## Gates

| Lane | Command | Result |
|---|---|---|
| Web | `pnpm exec vp test` in `apps/web` | 87 passed |
| Host | `pnpm exec vp test` in `apps/host` | 46 passed |
| C# FreshRevitProcess | `pe-revit test fresh --filter "FullyQualifiedName~RhvacCandidateBuilderTests\|FullyQualifiedName~RhvacEvalTests\|FullyQualifiedName~TakeoffReplayTests"` | 37 passed |
| Changed TS files | `vp check <seven changed TS files>` | format, lint, and types green |
| Typegen | `pnpm typegen:check` | exited 0; TS-only op left generated bridge contracts unchanged |
| Python | compiled `score-takeoff.py`; ran project-a four-verb sidecar | exited 0 |

Deterministic host serialization remains sorted and timestamp-free. Tests assert
v1 parsing and v2 sidecars containing only the original verbs. TypeScript and
C# regression tests also cover chained merges so an already-merged polygon is
not lost when its survivor is merged again. Host-local request decoding is
strict, so cross-action or unknown fields fail instead of being discarded.

The repo-wide unscoped `vp check` still reports 141 pre-existing formatting
issues outside this slice; every changed TypeScript file passes its scoped check.

## project-a scorer smoke

```text
RESOLUTIONS
touches accept:1  merge:1  reject:1  split:1
applied 4  remapped 0  orphaned 0
before ratio 2.42  score 54.1
after  ratio 2.41  score 53.3
```

This sidecar is a verb/replay smoke, not a curated score-improvement claim.
