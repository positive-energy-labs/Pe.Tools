# Live editability round — projectA, 2026-08-10 evening

Trigger: live session with kaitpw. Two chronic defects called out as binding, top priority:

1. **Interstitial space between rooms** — white unclaimed bands inside every wall ("rooms must
   touch!!!"). Root cause: `BuildDomain` excludes wall cells (no walkable headroom), so watershed
   fronts stop at wall FACES; the "fronts meet mid-ink" promise only ever held for low
   obstructions.
2. **Stairstep edges drawn on straight walls** — 67/82 project-a Main rooms fell back to raw raster
   loops, which make human adjustment of a FilledRegion literally impossible (the user could edit
   exactly one small wall on the whole level).

## Mechanisms shipped (no project-a constants)

- **Wall-band claim** (`PartitionFormulation`, `WallClaimFt = 1.5`): after sliver dissolution,
  non-domain cells sandwiched between owned cells within reach on an opposite axis-ray pair are
  claimed and split at the band centerline by multi-source BFS. Exterior faces (room on one side
  only) never claim; diagonal ray pairs deliberately excluded (they fillet concave exterior
  corners). project-a Main: 2,051 sf claimed; RawSqft becomes centerline semantics where claimed.
- **Editability over area fidelity** (`SpaceBoundaryNetwork`): straightened geometry ships
  whenever a valid loop assembles. The tight `RegularizeAreaTolerancePct` now only decides
  regularized STATUS (Space vs evidence FR); drift up to `HardAreaDriftPct` (25) ships flagged
  `area-drift`. Dirty paths assemble from their DP-fitted curves. Degree-1 endpoint gaps get
  bridged (`bridged-loop`, `LoopBridgeMaxFt = 4`). Rooms with no assemblable loop get a local
  DP + axis-snap straightener (`local-straightened`, holes best-effort). Residues straightened
  with the same machinery. Curved walls keep DP chords (allowed for now); 1-cell stairsteps
  survive only when geometry defeats every straightener (1 room out of 82).
- **Border residues not drawn** (`SpaceMaterializer`): a residue that touches the takeoff crop is
  an exterior leak (the 5,214 sf pool-terrace blob) — logged (`border residue X01 not drawn`),
  excluded from the drawn-evidence accounting identity.
- `TakeoffTsv.ParseTsv` area-integrity seam widened 3.5% → 27% to match the new polygon/RawSqft
  contract (still catches wrong-room POLY corruption).

## Measured (project-a replay + live)

| | before | after |
|---|---|---|
| Straight-geometry rooms (Main) | 15/82 | 81/82 (network 26, applied 34, local 21) |
| Regularized (Space-eligible) | 15 | 26 |
| Live materialize (Main) | 14 Spaces, 68 FRs, 2 line fallbacks, 2 FR failures | 31 Spaces, 52 FRs, 0, 0 |
| Scoreboard TOTAL | 54.1 | **54.4** (cover% up on every level) |
| Wall recall @1.5 ft | 53.4% | 43.1% (see note) |

Wall-recall note: the metric samples mined Bluebeam wall lines against candidate outer rings; part
of the drop is exactly the jogs/nubs straightening removes and part is DP/vertex-shift (up to
2.5 ft). The 80% gate was already failing before this round. Knobs if it matters:
`BoundarySimplifyFt`, `MaxVertexShiftFt`.

## Gates

- Offline NoDocumentRuntime filter: **45/45**.
- FreshRevitProcess canonical filter: **54/54** (census updated to the straightened-geometry
  truth: `(18, 65, 0, 0, 64, 2, 17)`, ring-repair failures 0).
- Committed project-a TSVs + room-map refreshed (`+33 auto-iou`); four-verbs fixture recurated
  (accept R04 / reject R77 / split R07 / merge R14→R08; binds 4 applied / 0 remapped / 0
  orphaned).
- Old-law tests rewritten to the new law (dogleg preservation → straightened-with-flags; raw
  fallback preservation → straightened fallback identity; area-guard revert → two-case
  within/beyond hard ceiling).

## Zoning-plan reference (user request)

The firm's `Mechanical Zoning Plan - *` views turn out to be hand-drawn FilledRegions (no Spaces,
no Zones, no color schemes in the doc). Extracted all 45 zone polygons + colors + type names to
`project-a/zones-mech.json` (`zones-mech.notes.md` for provenance). Grouping data — kept out of the
scoring oracle deliberately.

## Live verification state

Fresh dev session (Revit pid 49256) with project-a detached open; `PE-TAKEOFF spaces Level 1/Main
Level Future` shows the straightened, touching, per-room-colorized takeoff; border blob gone.
Readback (`ReadbackNative`) still pending the user's native room edits — that is the next
session's first move.

## Residue / open

- The one remaining raster room on Main (R03-class giant with degree-4 weld vertices) wants a
  turn-rule loop assembly rather than strict degree-2 (small mechanism, deferred).
- Locally-straightened neighbors can micro-diverge along a shared wall (flagged rooms only);
  the shared-path straightener covers the rest.
- Shape-gate defectors differ between blank-doc tests (17) and the live doc (4) — the gate reads
  native Space boundaries, which depend on the document; expected, but worth knowing.
- Wall-recall regression is deliberate; revisit only if the mined-wall lane becomes binding.
