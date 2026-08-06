# Mission: fine-cell probe — does 1.5-inch resolution separate junk from real small rooms?

Question: RESULTS-JUNK.md found that at CellFt=0.25 the interior-width acceptance threshold
is a discrete cliff (2.0 ft and 2.5 ft byte-identical outcomes) and junk is geometrically
inseparable from small real rooms. Hypothesis (user's): finer cells make width geometry
continuous and may open a separation window. Falsify or confirm with one level. Either
answer is a success; do not tune toward a desired outcome.

## Constraints
- Do NOT modify any C# source. This is a capture + measurement probe only.
- Live session: agent-owned sandbox lane ONLY (protocol proven twice — installed Pe.App
  --year 25, `dotnet tool run pe-revit -- sandbox start ... --wait` from worktree root,
  POST /call, open the detached project-a model from
  C:\Users\kaitp\OneDrive\Documents\MEP_ArchitectA_ProjectA_R25.rvt with
  DetachAndPreserveWorksets). NEVER touch the dev lane / take-over-host. Stop your sandbox
  when done.

## Steps
1. Read RoomTakeoff.Prepare/Detect + DetectSnapshot save/replay plumbing to learn how a
   custom TakeoffOptions flows in (run-takeoff.py shows the op-driving pattern). Via
   scripting.execute, run Prepare+Detect on "Upper Level" with TakeoffOptions{CellFt=0.125}
   (all else default), saving the replay snapshot to a NEW directory (do not clobber the
   standard snapshots). If memory/time allows, also CellFt≈0.0833 (1 in); if a capture
   exceeds ~10 min or fails on memory, record that as a finding and continue with what you
   have. Also record wall-clock + snapshot sizes vs the 0.25-ft baseline (cost matters).
2. Offline replay each capture to TSVs (PE_TAKEOFF_REPLAY_OUT + filter, HANDOFF.md recipe —
   Replay honors the snapshot's own CellFt).
3. New `eval/rhvac/probe-finecell.py` (do not modify score-takeoff.py): for Upper Level at
   each resolution (0.25 committed fixture, 0.125, and 1-in if captured):
   - mean best-IoU vs GT, candidate count, junk census (same 0.2 IoU rule)
   - wall recall at 1.5 ft and 0.75 ft
   - per-candidate interior width (largest inscribed disc via chamfer on a rasterized
     polygon — python, any method, state it) → two histograms: junk candidates vs
     GT-matched candidates <= 200 sf. THE DELIVERABLE: do the distributions separate at
     fine resolution (report overlap % / a threshold with precision+recall) where 0.25 ft
     could not?
4. Overlay: side-by-side render 0.25 vs 0.125 Upper polygons (junk in a distinct color) to
   eval/rhvac/project-a/probe/overlay_finecell.png.

## Deliverable
eval/rhvac/RESULTS-FINECELL.md: cost table (capture time, snapshot size, replay time per
resolution), quality table (IoU/junk/recall per resolution), the width-separation verdict
with histograms (ASCII or embedded numbers fine), and a 5-line recommendation: is a finer
default cell worth it, for what, at what cost? Honest NO is valid. Stage docs/scripts only;
snapshots stay local. Do not commit. Work autonomously; do not ask questions.
