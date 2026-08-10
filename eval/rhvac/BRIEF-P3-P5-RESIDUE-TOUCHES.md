# Mission: P3 residue lane + P5 touches-to-clean instrumentation

Two coupled items from eval/rhvac/PHASE5-EDITABILITY-PLAN.md (read fully). Do P3 first;
P5's metric is only honest once residue exists.

## P3 — residue: conservation for what the detector drops
The partition currently discards three classes silently-ish (logged as sf counters only):
border-touching regions (exterior leaks), sub-MinSqft crumbs, and sliver-dissolution
remnants that re-flood. Emit the FIRST TWO as `META residue` TSV lines with polygon +
label point + sqft + reason (border|crumb) — geometry that exists but is not a room.
Re-flooded sliver cells stay with their rooms (they are already owned). Requirements:
- Contracts.cs: residue record + ToTsv emission + LoadResult parse (round-trip test).
- Room TSV geometry must be BYTE-IDENTICAL modulo added META residue lines (tab-aware
  diff; grep -P is broken in this git-bash — use a printf'd tab).
- Web: parse residue (takeoff.ts), render unclaimed residue gray at low opacity in
  plan-pane.tsx, `claim-residue` verb per the plan (§2): union into a chosen neighbor
  (click) or promote to standalone room; anchor = residue label point; TS + C# + python
  apply mirrors + shared fixture coverage like the P2 verbs.
- scorer: residue census line per level (count, sf, claimed/unclaimed after --resolutions).
- Scale check: report residue counts per level. If border-drop residue is huge/noisy
  (e.g. Attic), it may swamp the UI — apply a MinResidueSqft knob (default 20, the same
  floor rooms use) and report what is excluded.

## P5 — touches-to-clean
Extend score-takeoff.py's RESOLUTIONS block into the plan's §4 metric: with --resolutions,
also print CLEAN status = {pending flags remaining, unclaimed residue count, candidate/GT
ratio vs 1.2, score delta vs unresolved baseline, taxonomy missing delta} and
touches-to-clean = total resolution count when clean, or the blocking reasons when not.
Then author (offline, by hand or scripted greedy from the scoreboard's junk/flag lists) a
DEMO sidecar for project-a Upper Level that drives it clean or as close as achievable:
reject the flagged junk, accept the true-positive small rooms, splits/merges where the
taxonomy names obvious cases. Commit-ready artifact at
eval/rhvac/project-a/demo-resolutions.upper.json + its scorer output in the results file.
This is the campaign's first measured touches-to-clean number — report it prominently,
including what remains dirty and why (e.g. fragmented rooms need merges whose survivors
are themselves imperfect).

## Gates
- Room geometry byte-identical modulo META lines, both projects; scores exactly 54.1/23.3;
  junk counts unchanged.
- Web (vp test in apps/web, 87 baseline), host (46), C# full filter green after fixture
  promotion (include RhvacCandidateBuilderTests; RhvacProjectAEvalRun excluded from claims).
- Renumber survival extends to claim-residue (fixture case).
- Fixtures: promote regenerated TSVs; report residue census per level.

Results to eval/rhvac/RESULTS-P3-P5.md. Stage, do not commit. Work autonomously; do not
ask questions.
