# P8 Materialize Everything Results

## Outcome

The mission is complete. The owned takeoff view now creates Spaces and separation
lines only for regularized rooms. Unregularized rooms, residues, and native-shape
defectors are retained as muted gray, halftone FilledRegions; invalid filled-region
loops fall back to owned outer-ring detail lines after consecutive duplicate removal.
Only the surviving Space population participates in area, total, and enclosure
validation.

## project-a Census

The FreshRevitProcess project-a Main Level test asserted this exact candidate-level
census:

| Spaces | Filled regions | Line fallbacks | FR failures | Rooms | Residues | Defectors | Deleted without replacement |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 43 | 31 | 31 | 72 | 3 | 9 | 0 |

Accounting held: `10 + 43 + 31 == 72 + 3 + 9 == 84`. Each of the 31 rejected
FilledRegion candidates produced an owned detail-line fallback and was logged; none
was silently skipped.

The synthetic idempotency test asserted `2 / 3 / 0 / 0` for Spaces / FilledRegions /
fallbacks / failures, including one unregularized room, one residue, and one native
shape defector. It also proves that the unregularized room creates neither a Space nor
separation lines.

## Known-red Seam

Preserved dogleg: straightening moves 6 sf (10.7%/13.6%), exceeding the 3% contract.
The prior known-red expectation was stale; the test now asserts the existing correct
unregularized result. Detector and replay production code were not changed.

## Gates

- Source compile: passed, 0 errors.
- Required FreshRevitProcess filter: 45 passed, 0 failed, 0 skipped; build, test, and close exit codes were 0.
- Accounting invariant: asserted in synthetic and project-a document-backed tests.
- `python eval/rhvac/score-takeoff.py`: `TOTAL SCORE 54.1` exactly.
- `git diff --exit-code -- '*.tsv'`: passed.
- `git diff --exit-code -- source/pe-tools/`: passed.
