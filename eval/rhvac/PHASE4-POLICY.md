# Phase 4 — Evidence-derived per-level policy (kill the project-a name-match)

## Why now (measured)

project-b cold test (eval/rhvac/project-b/NOTES.md, 2026-08-05): Regions 22.0 / Partition 23.3 vs
project-a 52.7/54.1. Root causes visible in the taxonomy:

1. **Policy never fired.** `PolicyFor` (ProjectAReplayDumpRun.cs) and run-takeoff.py LEVEL_POLICY
   match project-a level *names* ("Main Level", "Attic"...). project-b' "MAIN LEVEL" / "ROOF PLAN" fell
   through to stock options: no RequireCeiling domain gate, no door-head sealing, no seed policy.
2. **No-room levels aren't recognized.** Partition manufactured a 2,524.6 sf candidate on
   ROOF PLAN (zero GT). A level with no habitable floor evidence must yield zero rooms by
   construction, not by luck.
3. **GT area coverage ~50%** — half of project-b' rooms never enter the domain. Missing 8–9/22.

Phase-3 verdict (PHASE2-PARTITION.md): snapping is editability-only. Score now lives in
coverage + policy generalization, and project-b is the falsification instrument.

## Design

Replace name matching with a `LevelProfile` inferred from the DetectSnapshot itself, before
formulation runs. One new pure function in Pe.Revit.Takeoff:

```
LevelProfile InferLevelProfile(DetectSnapshot snap)
```

Signals (all computable from the existing heightfield + ink):

- **ceilingCoverage**: fraction of ink-bounded domain cells with a real ceiling within
  StoryCap. High (>~0.5) → RequireCeiling=true is safe (the "Flat()" profile). Low → the gate
  would erase real rooms; leave it off but flag the level `low-ceiling-evidence`.
- **habitableFraction**: cells with floor-within-FloorTol AND headroom ≥ MinHeadroomFt over the
  ink-bounded domain. Near zero → the level is a roof/plenum plan: emit zero candidates plus a
  `META flag level:<name>:no-habitable-domain` line. This kills failure (2) by construction.
- **slopedCeilingFraction**: cells whose ceiling gradient exceeds a walkable-attic threshold.
  High → attic profile (MinHeadroomFt 3.5, CeilingCloseFt 3, StoryCap widened).
- **doubleHeightFraction**: cells with headroom > ~1.5 stories → widen StoryCapFt (Upper-Level
  case) instead of a hardcoded 26.
- **seed policy**: Hybrid where ceiling-step evidence is trustworthy. Measured proxy from the
  campaign: ceil-step wall-precision lift (≥ ~2 → Hybrid, else RegionCores). If the proxy can't
  be computed cheaply, start with: Hybrid iff ceilingCoverage high AND slopedCeilingFraction
  low-to-moderate; basements (level elevation < 0 relative to site, or low ceilingCoverage)
  stay RegionCores.

Thresholds are mechanisms with defaults (like TakeoffOptions), calibrated once against BOTH
benchmarks — a threshold only survives if it reproduces the hand policy on project-a (per-level:
Flat/L0, Flat+Hybrid/L1, stock-or-Flat/Theatre, Flat+26/L2, Attic/L3) AND improves or holds
projectB. Log the inferred profile per level in the TSV header (`META profile ...`) so provenance
is inspectable.

## Falsification protocol

1. Implement InferLevelProfile + wire into replay lane behind `PE_TAKEOFF_POLICY=Inferred`
   (default stays the name-matched mirror until parity is proven).
2. **Parity gate (projectA):** inferred profiles must reproduce the measured hand policy on all 5
   project-a levels; score within ±0.3 of 52.7 (Regions) / 54.1 (Partition). If a level's inferred
   profile disagrees with the hand policy, that's a finding — measure both, keep the winner,
   record it.
3. **Generalization gate (projectB):** ROOF PLAN yields 0 candidates; MAIN LEVEL score must not
   regress vs 23.3, and the RequireCeiling/sealing gates should recover some of the 8 missing
   rooms. Record honest numbers either way.
4. Only after both gates: flip default to Inferred, delete the name-matched policy from
   ProjectAReplayDumpRun + run-takeoff.py (single source of truth in the library), commit.

## Out of scope

- Registration quality on project-b (cold-fit is weak; separate workstream — don't tune the
  detector to compensate for a 3.6 ft registration residual).
- Boundary snapping (closed, editability-only).
- project-a missing-room recovery beyond what the gates naturally give.
