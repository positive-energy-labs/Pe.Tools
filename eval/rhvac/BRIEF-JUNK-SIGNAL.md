# Mission: non-geometric junk signal — raise suspect recall past the geometry ceiling

Base: RESULTS-SUSPECT-FLAGS.md. suspect:narrow/compactness reaches 97.4% precision but
only 30.1% recall on sub-60-sf junk (57 unflagged remain): the unflagged junk is COMPACT
closet-lookalike pockets that pure shape cannot separate. RESULTS-FINECELL.md proved finer
resolution does not help. The remaining signals are non-geometric — use what the detector
already knows about each region's EVIDENCE and CONTEXT. Flags only; geometry must stay
byte-identical modulo META flag lines (verify with the tab-aware diff; grep -P is broken
in this git-bash, use a printf'd tab).

## Candidate signals (pick by measured evidence on the replay data, not by list order)
- Boundary evidence support: fraction of the region's boundary backed by strong evidence
  (>= BoundaryEvidenceMin). Real rooms are mostly wall-bounded; junk pockets often have
  high support too (they live IN walls) — measure both directions before assuming.
- Ceiling character: fraction of cells with ceiling in a normal band, ceiling variance;
  chases/voids differ from closets.
- Adjacency dominance: junk slivers typically share nearly all their boundary with ONE
  neighbor or sit wholly within the dilated ink band; a real closet has door-gap evidence
  or its own ceiling signature.
- Seed provenance: seedless components and re-flooded sliver remnants (already tracked)
  correlate with junk — check whether existing flags can simply be unioned into suspect.
Instrument first: dump per-region signal values for all 285 project-a candidates, join
against the scoreboard's junk truth (best-IoU < 0.2) offline in python, and pick
thresholds/combinations from that evidence. Mechanisms + knobs with defaults; no projectA
constants.

## Gates (binding)
- Geometry byte-identical modulo META flag lines, both projects (state the diff).
- TOTAL exactly 54.1 / 23.3; junk counts unchanged.
- Unflagged junk < 60 sf: project-a 57 -> <= 25.
- Suspect-flag precision >= 85% overall; flagged-but-matched (false positive) rooms <= 20
  across all levels — every one listed with its area and IoU so a human can audit.
- Tests: full C# filter green after fixture promotion (include
  RhvacCandidateBuilderTests; exclude RhvacProjectAEvalRun from pass/fail claims).
- Fixtures: promote regenerated TSVs (META-only diff), report flag census per level.

If the signals cannot reach <= 25 unflagged without dropping precision below 85%, stop at
the best honest point and write the tradeoff curve (unflagged vs false positives at 3-4
operating points). Results to eval/rhvac/RESULTS-JUNK-SIGNAL.md. Stage, do not commit.
Work autonomously; do not ask questions.
