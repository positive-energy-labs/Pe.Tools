# Takeoff refinement campaign (started 2026-08-03)

Goal: refine auto-takeoffs until no further refinement is possible. The output contract is a
**partition** of the conditioned footprint — straight walls, no holes, no slivers, shared
boundaries, ambiguity flagged — easy for a human/pea to edit in Revit or the /rhvac UI before
conversion. The pre-commit human edit surface is the antidote to intent ambiguity; the detector
never guesses intent.

## Ground rules

- **Mechanisms generalize; thresholds don't.** project-a is the adversarial benchmark, not the spec.
  No project-a-specific constants in core logic (per-project knobs with sane defaults are fine).
- Every detector change is judged by the scoreboard (`eval/rhvac/score-takeoff.py`), never by
  eyeballing renders. Falsify before believing; a plausible mechanism gets measured on the live
  data before it lands (see HANDOFF.md falsification-pass precedent).
- Structural properties are enforced **by construction**, not tuned toward:
  partition (no holes/gaps), boundaries on a wall-line arrangement (no stair-steps),
  min feature width (no slivers), explicit ambiguity flags (no guessed intent).
- Iteration runs offline via the replay harness wherever possible; live Revit sessions only for
  capture + periodic re-verification.
- Bounded mechanical grinds may be delegated to `codex exec "<prompt>"`.

## Phases

1. **Instrument** (in flight): per-room IoU scoreboard vs mined Bluebeam ground truth
   (145/150 rooms, 936 wall lines, all-level registration) + auto room-map curation;
   offline replay harness for the detector's post-Revit stages.
2. **Partition reformulation**: replace independent region growing with a partition of the
   walkable/conditioned footprint; every cell assigned; boundaries at wall centerlines
   (matches ASHRAE mid-partition convention and kills the −13.5% area undershoot class).
3. **Wall-line arrangement**: detect dominant wall directions, snap partition boundaries to a
   line arrangement; straight edges by construction; retire post-hoc polygon simplification.
4. **Iterate to plateau**: offline loop against the scoreboard; failure-taxonomy-driven
   (missing / fragmented / merged / shape-poor per room); attic + openings lanes once the
   main-floor score plateaus; periodic live re-verification.
5. **Editability surface**: detector emits ambiguity flags (open-plan blobs, low-evidence
   boundaries) that the /rhvac UI and Revit lane render as one-action human resolutions
   (split line, merge, accept). Perfect = geometric where determinable, one-touch where not.

## State log (append per phase completion)

- 2026-08-03: Bluebeam mining landed (cc80353) — per-room geometric oracle exists.
