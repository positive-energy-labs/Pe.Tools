# Mission: make the takeoff scoreboard measure usability, not just IoU delta

Context: the current loop optimizes mean IoU over GT rooms (saturated ~0.54 against fuzzy
registration) while junk candidates are free (285 candidates vs 132 real rooms) and visual
quality is never gated. Your job is to fix the *measurement*, not the detector. Do not touch
any file under `source/Pe.Revit.Takeoff/` except reading it.

## Read first
- `eval/rhvac/score-takeoff.py` (the scoreboard)
- `eval/rhvac/project-a/SCOREBOARD.md` (current baseline + honesty ledger)
- `eval/rhvac/REFINEMENT.md` (campaign ground rules)
- `eval/rhvac/overlay.py` (existing render tool)

## Deliverables (all in eval/rhvac/, python only)

1. **Precision accounting in score-takeoff.py.** For every candidate polygon, find its best
   IoU against any same-floor GT room. Report per level and total:
   - candidate/GT count ratio
   - junk census: candidates with best-IoU < 0.2 (count, total sf, area histogram
     <60 / 60-150 / >150 sf, and the worst 10 by area listed with centroid so they can be
     found on the overlay)
   - matched-candidate fraction.
   Do NOT change the meaning of TOTAL SCORE (comparability with the state log); add a new
   `PRECISION` block alongside it.

2. **Absolute gates.** A new `GATES` section printed on every run and a `--gate` flag that
   exits nonzero when any fail. Initial gates (constants at top of file, commented):
   - candidate/GT count ratio <= 1.2 per level
   - taxonomy ok >= 80% of GT rooms
   - zero junk candidates < 60 sf (best-IoU < 0.2)
   - wall recall >= 80% at 1.5 ft.
   These will all FAIL today. That is the correct outcome — do not tune them to pass.

3. **Overlay in the loop.** score-takeoff.py invokes the overlay render automatically per
   level, writing `overlay_<level>.png` next to scoreboard.txt, with junk-census candidates
   visually flagged (distinct color). If overlay.py needs a flag for that, add it.

4. **Amend REFINEMENT.md ground rules**: replace "judged by the scoreboard, never by
   eyeballing renders" with: judged by the scoreboard INCLUDING the absolute GATES section,
   with the per-level overlays attached as evidence in any phase-close note; a phase may not
   be recorded closed while gates fail unless the log names each failing gate explicitly.

## Proof commands (run and paste outputs into a short RESULTS.md next to this brief)
- `python eval/rhvac/score-takeoff.py` (project-a default) — must still reproduce TOTAL 54.1
  exactly, plus the new PRECISION and GATES blocks; registration self-check assert must pass.
- `python eval/rhvac/score-takeoff.py --takeoff-dir eval/rhvac/project-b/takeoff` (adapt if the
  project-b invocation differs; check project-b/NOTES.md) — same blocks.
- `python eval/rhvac/score-takeoff.py --gate; echo $?` — nonzero.

Constraints: no new dependencies beyond what overlay.py already imports. Keep diffs minimal;
no refactors of scoring code you don't need. Stage your work but do not commit.
Work autonomously; do not ask questions.
