# Mission: junk-suspect flagging — flag, don't reject

Context: eval/rhvac/RESULTS-JUNK.md proved geometric acceptance CANNOT separate junk from
small real rooms at 0.25-ft cells (the width threshold that kills junk kills a real 31.9-sf
mech room). Agreed direction: the detector never decides — it FLAGS. Junk-suspect regions
stay in the output with an ambiguity flag; the human/pea resolves them one-touch (reject or
accept) in the existing flag queue. The web UI already renders and queues unknown flag kinds
verbatim, so no UI work is needed.

## Scope
1. In `PartitionFormulation.cs`, after sliver dissolution: compute per-region interior width
   (median-chamfer, reuse your Part-2 machinery from the reverted attempt — see
   RESULTS-JUNK.md iterations) and isoperimetric compactness. Regions failing width
   (< MinFeatureWidthFt interior) or compactness (< knob, default from your iteration 3
   findings) get flag `suspect:narrow` or `suspect:compactness` (flag string format must fit
   the existing `META flag` lane; check how multi-flag rooms serialize). GEOMETRY MUST NOT
   CHANGE — no rejection, no re-flooding, no residue. TSVs must be byte-identical to the
   committed fixtures EXCEPT added/changed META flag lines. Verify with a diff and state it.
2. In `eval/rhvac/score-takeoff.py`: parse META flag lines from candidate TSVs (it currently
   ignores them — confirm). PRECISION block gains a flagged/unflagged split of the junk
   census. New gate (added to GATES): "zero UNFLAGGED junk candidates < 60 sf". Keep every
   existing gate untouched.
3. Report flag quality as the headline (this is the deliverable): treating best-IoU < 0.2 as
   junk truth — suspect-flag precision (% of flagged that are junk), recall (% of junk < 60 sf
   flagged; also all junk), and the false-positive list: every MATCHED-to-GT candidate that
   got flagged (the 31.9-sf mech room should appear here — that is acceptable and expected;
   one accept-touch clears it, silence does not).

## Gates (binding)
- Replay TSVs byte-identical to committed fixtures modulo META flag lines (state the diff).
- TOTAL SCORE exactly 54.1; PRECISION junk counts unchanged (geometry untouched).
- New gate "zero unflagged junk < 60 sf" PASSES on projectA.
- Suspect-flag false positives (flagged real matched rooms): <= 12 across all levels — if the
  mechanisms can't get there without project-a constants, report the honest number and stop.
- project-b replay: no TSV geometry change; report its flag stats too.
- Existing tests green: dotnet test filter FullyQualifiedName~TakeoffReplayTests plus
  FullyQualifiedName~TakeoffPartitionTests.

Iterate offline via the replay harness (HANDOFF.md RE-VERIFY recipe). Write before/after and
the flag-quality tables to eval/rhvac/RESULTS-SUSPECT-FLAGS.md. Stage, do not commit. Work
autonomously; do not ask questions.
