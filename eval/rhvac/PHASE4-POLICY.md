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

## Iteration log (2026-08-05)

Implemented `TakeoffPolicy.InferLevelProfile(DetectSnapshot)` as a pure heightfield/ink policy.
The inference closes the detector's seed ink, flood-fills the exterior, and measures ceiling and
habitable coverage only over enclosed floored cells. Slope, double-height, and ceiling-step/ink
lift remain field-wide signals. Thresholds live in `LevelProfileThresholds`; no project or level
names occur in the inference. Inferred TSVs include one deterministic `META profile` provenance
line. A zero bounded habitable domain returns zero candidates and emits
`META flag level:<name>:no-habitable-domain`.

Profiles inferred from the five project-a snapshots:

| level | ceiling / habitable / slope / double-height | step-ink lift | inferred policy |
|---|---:|---:|---|
| Level 0/Lower Level | .9979 / .8827 / .3044 / .0023 | 1.5181 | Flat, RegionCores, cap 14 |
| Level 0/Theatre | .9302 / .1205 / .0807 / .0036 | 4.1986 | Flat, RegionCores, cap 14 |
| Level 1/Main Level | .6777 / .5354 / .1502 / .0024 | 3.7078 | Flat, Hybrid, cap 14 |
| Level 2/Upper Level | .8991 / .7955 / .1333 / .1331 | 2.7016 | Flat, Hybrid, evidence-derived cap 26 |
| Level 3/Attic | .9725 / .4991 / .4059 / .0060 | 1.3699 | sloped, Hybrid, headroom 3.5, close 3, evidence-derived cap 27 |

Parity measurements from fresh five-bin offline replays plus `score-takeoff.py`:

| formulation | inferred score | required reference | result |
|---|---:|---:|---|
| Regions | 52.4 | 52.7 +/- 0.3 | pass at the lower bound |
| Partition | 54.1 | 54.1 +/- 0.3 | exact pass |

Theatre is the permitted stock-or-Flat ambiguity. Flat costs Regions 0.3 TOTAL versus its 52.7
stock hand-policy control, but is required to prevent the Partition apron domain; the shared
profile therefore keeps Flat and Partition remains exactly 54.1. Attic's derived 27 ft cap differs
from the hand policy's 30 ft cap, but both emit 49 Regions candidates / 51 Partition candidates and
the same .310 / .475 attic mIoU, so the smaller evidence-derived cap wins the tie.

project-b generalization (exact two-bin filter, Partition): MAIN LEVEL remains 20 candidates and 23.3
TOTAL, with 54.0% GT coverage, 40.6% outside-GT area, and the same missing-8 taxonomy. The inferred
profile is Flat+Hybrid (`ceilingCoverage=.9565`, `habitableFraction=.9117`, step-ink lift 1.9044).
No missing room was recovered; that hoped-for secondary effect is falsified. ROOF PLAN now emits
0 candidates / 0 sf instead of the 2,524.6 sf false candidate and carries the required
`no-habitable-domain` flag.

Both binding gates pass, so inferred policy is now the default. The name-matched
`ProjectAReplayDumpRun.PolicyFor` and `run-takeoff.py LEVEL_POLICY` tables were deleted; live capture
uses a generic 30 ft evidence cap, then applies the inferred profile in the library. `Stock`
remains only as an explicit stock-options replay control.

Final source-compile/offline proof: the complete `LibraryBehavior.NoDocumentRuntime` filter,
excluding the two explicit operational eval drivers, passed 34/34 in `Debug.R25.Tests`.
`Partition_replay_is_deterministic` saves the synthetic snapshot and compares inferred Partition
TSV bytes from two independent loads. The coverage-ledger check is current at 133/133 in-model
rooms, and the replay/score Python entrypoints compile cleanly.
