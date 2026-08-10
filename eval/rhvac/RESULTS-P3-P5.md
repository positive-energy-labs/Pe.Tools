# P3 residue + P5 touches-to-clean results

## Outcome

P3 now conserves final unowned `border` and `crumb` regions as polygonal `META residue`
records. The web plan renders them gray and can either union one into a clicked neighbor or
promote it to a room. TypeScript, C#, and Python replay the same `claim-residue` sidecar verb;
`residue-claim-remap.json` proves both actions survive detector renumbering.
Reject decisions preserve removed room polygons as explicit `rejected`, already-claimed residue
in every replay mirror; no reviewed geometry disappears silently.

`MinResidueSqft` defaults to 20 sf. Replayed fixture census:

| Project / level | Emitted | Emitted sf | Excluded below 20 sf | Excluded sf |
|---|---:|---:|---:|---:|
| project-a Lower | 1 | 32 | 257 | 57 |
| project-a Theatre | 7 | 538 | 118 | 180 |
| project-a Main | 2 | 5,259 | 744 | 189 |
| project-a Upper | 12 | 11,394 | 973 | 513 |
| project-a Attic | 4 | 137 | 2,072 | 1,011 |
| project-b Main | 1 | 30 | 2 | 9 |
| project-b Roof | 0 | 0 | 0 | 0 |

The large Upper/Main border leaks are only three and one polygons respectively, so the UI is
not count-swamped. The 20 sf floor removes 4,166 tiny components across the two fixtures.

## Conservation and score gates

Removing lines beginning with the literal `META<TAB>residue<TAB>` leaves all seven regenerated
TSVs byte-identical to their prior room geometry. Fixture TSVs were promoted to the projectA,
projectB, and web fixture locations.

- projectA: **54.1**, 285 candidates, 184 junk candidates (unchanged).
- projectB: **23.3**, 20 candidates, 9 junk candidates (unchanged).

## Upper Level demo: 93 touches to clean

`project-a/demo-resolutions.upper.json` is a deterministic v2 sidecar over the committed Upper TSV:

- 41 reject decisions for scoreboard-proven junk candidates.
- 40 accept decisions for flags on retained candidates.
- 12 `claim-residue` decisions promoting all emitted residue.
- 93 applied, 0 remapped, 0 orphaned.

This is the first measured touches-to-clean result: **93 touches**. No split/merge was added from
the scoreboard alone because it does not establish a safe chord or survivor; the conservative
accept/reject/promote campaign already reaches every CLEAN condition without changing score.

Scorer output:

```text
TOTAL SCORE 54.1
RESOLUTIONS
touches accept:40  claim-residue:12  reject:41
applied 93  remapped 0  orphaned 0
before ratio 2.42  score 54.1
after  ratio 2.17  score 54.1
residue Level 2/Upper Level: 53 total  17485.2 sf  claimed 53  unclaimed 0
CLEAN Level 2/Upper Level: CLEAN - touches-to-clean 93; pending=0 residue=0 ratio=1.11 scoreDelta=0.0 missingDelta=0
```

The before/after ratio lines are whole-project diagnostics; CLEAN correctly gates the touched
Upper level at 1.11 against the 1.2 limit. Upper score delta is 0.0 and taxonomy missing delta is
0.

## Verification

- Source compile: `Pe.Revit.Takeoff` succeeded with 0 warnings/errors.
- FreshRevitProcess: `LibraryBehavior.NoDocumentRuntime` excluding only
  `RhvacProjectAEvalRun` passed 43, skipped the 2 explicit operational dumps, failed 0.
- Web: 88/88 passed (87 baseline plus the shared residue claim/remap case).
- Host: 46/46 passed.
- Python claim/remap mirror fixture passed.
- Room geometry modulo residue lines: 7/7 byte-identical.
