# Handoff — Takeoff → RHVAC eval loop (2026-07-24, evening: falsification pass)

For the next agent iterating on autonomous takeoffs. Read `source/Pe.Revit.Takeoff/Rhvac/README.md`
first (format authority + eval harness), then this file. This pass adversarially audited both the
eval harness and the detection internals, live-falsified the competing causal theories on the real
project-a model, and landed two mechanism changes as opt-in flags. Every number below was measured,
not inferred.

## The score is honest now (metric surgery, landed)

The old headline (38.1% area coverage) was circular: 73/74 matches were greedy area-auto-matches,
then scored on area agreement. `RhvacEval.Score` now gates on CURATED matches only:

- Gated coverage counts explicit `room-map.json` matches alone: **2.5% area / 2.2% cfm** today.
- Provisional (area-auto-matched) pairs still run for diagnostics but can only ever produce
  warnings, and their coverage prints as a separate `(+provisional, diagnostic)` line (38.1/49.3).
- `RhvacCandidateBuilder.ParseTsv` fail-fasts if a TSV's RawSqft disagrees with its own polygon
  area (>2% / >2 sf) — the redundant-truth cross-check the harness lacked.
- Self-tests: 18 green (`--filter "FullyQualifiedName~LibraryBehavior.NoDocumentRuntime.Rhvac&FullyQualifiedName!~ProjectAEvalRun"`),
  including two new ones pinning the never-gate semantics of provisional pairs.

Growing the gated number means growing the curated match set with evidence (see tooling below),
not loosening the matcher. A wrong match still poisons every per-room metric; the curator's 9:1
bar in `room-map.notes.md` now actually governs the score.

## What was falsified on the live model (all reproducible)

Detection is deterministic: the committed TSV snapshot reproduced byte-identically across two full
Revit restarts + re-Prepares.

| Level failure (per old scorecard) | Real mechanism (live-proven) |
|---|---|
| L0 captured 14% | Area was DETECTED all along; `MinCompactness` deleted it. `MinCompactness=0`: 13→23 rooms, 1,978→16,595 sf. Ceiling/headroom gates: zero effect (duct-as-ceiling theory dead). |
| L1 main house: 0 rooms | Envelope openings leak the whole wing into the terrace/site apron → one 22,578 sf border-touching region (logged) → deleted. Floors+ceilings are solid across the wing. The control's only L1 "rooms" on that wing were its PORCHES. |
| L1 kitchen-wing 5.5k blob | Genuinely open plan: interior has NO wall geometry (verified in ink + views). Oracle rooms there are the engineer's functional ZONES. No wall detector can split them — needs proposal+curation semantics or non-wall evidence. |
| L3 dormer fragments | Untested this pass (next loop; expect band/eave interactions). |

project-a ground truth that makes this the hard case on purpose: the arch link is 55,634 Generic
Models, every one named "Undefined", IfcName empty, 0 Rooms, 0 Walls, no usable layers.
Geometry-agnostic is not optional here.

## Two mechanism changes landed as opt-in `TakeoffOptions` flags

1. **`RequireCeiling`** — ceiling presence joins the per-cell existence mask ("indoors = covered").
   Kills fake porch/terrace rooms, and envelope leaks stop reaching the crop border (outdoors is
   no longer walkable space). This deliberately contradicts the old "ceiling only gates regions"
   doctrine; the measured result wins.
2. **`SealDoorHeads`** (+`DoorHeadMaxFt` 8.75, `DoorHeadContrastFt` 1.5) — doorways read in the
   heightfield as short low-CeilZ (lintel) strips flanked by taller cells; those cells become
   obstruction. Geometry-derived door sealing, no PNG header band involved.

Measured, with `MinCompactness=0` (gate discussion below):

| Config | L0 (oracle 23 rooms / 14,115 sf) | L1 (oracle ~46 / 14,519 sf + garage/staff wing) |
|---|---|---|
| Control (committed snapshot) | 13 / 1,978 sf | 21 / 9,073 sf (main house absent) |
| RequireCeiling + noCompact | 25 / 14,461 sf | 37 / 21,797 sf (main house back as 12.3k blob) |
| + SealDoorHeads | **43 / 13,985 sf** (10.9k blob → 6.2k + 1,327 + many 245–470 sf rooms) | 37 / 21,785 sf (no change: 39 sf sealed) |

L2/L3 under the full flag set (RequireCeiling + SealDoorHeads + noCompact) vs control:

- L2 Upper: 57 / 11,527 → **68 / 14,992 sf** (oracle 49 / 13,097) — mild win, gained a 3.5k blob
  that needs an overlay look (recovered rooms vs covered-exterior).
- L3 Attic: 27 / 3,337 → **13 / 1,828 sf (REGRESSION, mask shattered into 3,798 regions)** —
  RequireCeiling + the hardcoded `lvlZ+14` ceiling cap + 6 ft headroom cannot describe sloped
  volumes. The flags must be per-level policy, not unconditional defaults; the attic needs its own
  covered-space definition (e.g. "roof above counts as ceiling", headroom relaxed to a
  volume-preserving convention).

Why door-seal is a no-op on L1: the framing-stage main house has NO header geometry over
doorways — openings are full-height gaps. That led to the third landed flag:

3. **`SealWallRunGaps`** (+`DoorGapMaxFt` 4.5, `DoorJambMinFt` 2.0) — close a gap in the
   obstruction mask only when it is a short colinear break between two solid ink runs, scanning
   H, V and both diagonals (rotated wings). Corridor mouths survive because a crossing wall reads
   as a short run. Measured (all with RequireCeiling + SealDoorHeads + noCompact):
   - **L1: 37 → 71 rooms** — the 12.3k main-house blob split into 3.6k + 3.3k open-plan zones
     plus a full spread of real rooms (1,025 / 779 / 644 / 633 / 569 / 558 …); 801 sf sealed.
   - **L2 (with `StoryCapFt=26` for double-height rooms): 77 rooms / 14,376 sf**, prior 3.5k blob
     split. `StoryCapFt` replaced the hardcoded `lvlZ+14` ceiling-search cap (Heightfield +
     Detector) — double-height spaces read no-ceiling under the old cap.
   - **L0: 57 rooms / 13,162 sf** — the residual 6.2k blob split into 1,338 / 1,256 / 855 / 707 …
   - **Attic: fixed by the roof-covered space model** (`CeilingCloseFt=3` closes the patchy
     rafter ceiling mask + `StoryCapFt=30` reaches the ridge + `MinHeadroomFt=3.5` keeps
     knee-wall area + lintel seal): **49 rooms / 5,662 sf vs oracle 5,758 (98%)**, from 58%
     stock. Wall-run sealing measurably fragments knee-wall areas — kept OFF for attics.

## Rework directive (evidence-backed, not yet applied as defaults)

1. DONE as per-level policy in `run-takeoff.py` (`LEVEL_POLICY`): flat levels take
   RequireCeiling + both sealers + no compactness gate; Upper Level adds `StoryCapFt=26`; Attic
   stays stock. Migrate this policy from the driver into conventions.json / the product path when
   the takeoff surface ships.
2. DONE (`SealWallRunGaps`). Next: measure whether the header-band seed view (B) still earns its
   render + two global height knobs now that both sealers exist.
3. **Delete `MinCompactness` as a room-killer.** It amputated 86% of L0. Replace with per-room
   confidence flags (blob-suspect: area ≫ level median; snake-suspect: low compactness;
   border-adjacent) surfaced to the eval + UI. No silent deletion anywhere — blobs and snakes ship
   as low-confidence proposals; curation or later evidence resolves them. Same treatment should
   eventually replace the border-touch wholesale rejection (today it also eats a 6.8k sf covered
   region on L1 — porte-cochère class — that never got a chance to be split from the interior).
4. Open-plan blob splitting is a PRODUCT stage, not a morphology fix: takeoff proposes the blob
   with uncertainty; zone-splitting uses overlay visuals + curation (or future non-wall evidence:
   floor material seams, ceiling features). Do not chase it with thresholds.
5. The PNG knee-ink path is NOT currently the bottleneck (ink quality was good everywhere it
   mattered) — do not rewrite it on aesthetic grounds. Revisit only for diagonal-wall direction
   fidelity (builder buckets staircase edges into N/E instead of NE; detect diagonal runs in
   BoundarySimplify output first) or if wall-run sealing needs vector wall runs anyway.
6. Eval follow-ups: CFM-weight the coverage gate; stamp detector version/commit into TSV META and
   assert on load (snapshot-rot guard); grow curated matches via the overlay tooling.

## Curation/debug tooling (new)

- `eval/rhvac/overlay.py` — renders the persisted ink raster + candidate polygons + labels in
  model feet (exact registration by construction). `--live` uses the Documents takeoff dir (right
  after a detection run); default uses the committed fixture TSVs (pass `--ink-dir` from the same
  run). This is how the mega-blob/porch/leak mechanisms were seen — use it before believing any
  detection theory.
- Floormask dump recipe (per-cell floor/ceiling/headroom classes → colored PNG): reconstruct the
  crop from the ink bin header, call `Heightfield.Build` via scripting, classify cells. See the
  session driver scripts pattern; 10 lines of C# + 20 of Python.
- Identity curation path (started, unfinished): MEP plan views carry the drafter's room labels;
  `revit.context.view-image` captures them, view CropBox basis gives the model→pixel map
  (scratchpad `mechoverlay.py` projects candidates onto rotated captures). The near-miss list in
  `room-map.notes.md` items 1–5 is the target: confirm identities visually, grow the curated set.

## The loop (unchanged commands)

Offline score: `dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "FullyQualifiedName~RhvacProjectAEvalRun" -v q --nologo`
Live regen: `python eval/rhvac/run-takeoff.py --port <host> --session <bridge-session-id> --project project-a --levels ...` (session tricks: agent memory `worktree-lane-access`).
Re-detection renumbers candidate ids → re-derive every `room-map.json` key after regenerating TSVs.

## Offline detection loop (2026-08-04: replay harness landed)

Detection iteration no longer needs live Revit once ONE capture exists. `Detector.Detect` is now
Revit-free (takes level name + elevation instead of `Level`), and `DetectSnapshot`
(`source/Pe.Revit.Takeoff/DetectSnapshot.cs`) persists exactly what it consumes: the heightfield
(FloorZ/CeilZ + grid frame), the composed seed ink, the level identity, and a record of the
capture-baked knobs. The loop is capture once → iterate offline → re-verify live occasionally.

- **CAPTURE (live, once per detection-input change).** `RoomTakeoff.Detect` writes
  `replay_<level>.bin` (gzip, ~5–15 MB/level) next to `rooms_<level>.tsv` in the Documents
  takeoff dir by default (`TakeoffOptions.DumpReplaySnapshot = true`). The next normal snapshot
  regen captures everything — the exact command is unchanged:
  `python eval/rhvac/run-takeoff.py --port <host> --session <bridge-session-id> --project project-a --levels "Lower Level" "Main Level" "Upper Level" "Attic"`.
  No pre-2026-08-04 artifact can substitute: `ink_*.bin` is post-detect evidence ink (knee|floorEdge,
  not the seed ink Detect consumes), `floormask_*.bin` is a z-less presence mask from deleted
  experiment code, and the seed PNGs lack the heightfield — FloorZ/CeilZ were never persisted, so
  the harness ships synthetic-tested until the first live run.
- **ITERATE (offline, seconds per run).** `DetectSnapshot.Load(path).Replay(opt, log)` reruns
  everything from obstruction morphology through TSV with arbitrary `TakeoffOptions`: door
  sealers, region growing, ceiling/compactness gates, `PartitionRegularizer`, loop tracing,
  `ToTsv()` (same code path the live lane commits). Tests:
  `source/Pe.Revit.Tests/LibraryBehavior/NoDocumentRuntime/TakeoffReplayTests.cs` — a synthetic
  estate (4 rooms, two 3-ft door gaps, diagonal wall, open plan) proves determinism + option
  sensitivity, and `ProjectA_snapshot_replays_deterministically` upgrades itself to the first real
  `replay_*.bin` it finds in the Documents takeoff dirs (skipped until then).
- **RE-VERIFY (live).** Everything UPSTREAM of the seam is baked at capture time; offline results
  that touch those knobs are void and need a live re-capture: the heightfield build window
  (`FloorTolFt`, `StoryCapFt`, `CeilingCloseFt` — CeilZ above the capture cap simply is not in
  the file), ink composition (`KneeBandFt`/`HeaderBandFt`/`BandPairSeparationFt`/`HeaderNearFt`/
  `SeedPixelSize`), and `CellFt` (Replay fail-fasts on mismatch). `FloorTolFt`/`StoryCapFt` are
  half-replayable: they re-gate existing values offline (tightening is honest) but cannot admit
  cells the capture window excluded. All other `LEVEL_POLICY` knobs (RequireCeiling, both
  sealers, MinCompactness, MinHeadroomFt, MinCeilingFrac, partition/simplify knobs) are fully
  downstream and iterate offline honestly.

## Traps (new ones from this pass — the old list in git history still applies)

- **`dotnet test` in the worktree poisons the emitter**: the Pe.Revit.Ui WPF build drops a
  transient `*_wpftmp.csproj`; the emitter goes `restart-required` and edits silently stop
  applying. Check the events jsonl tail before trusting a hot-reload; run tests only when you can
  afford a `live converge --restart`.
- Seed views do NOT survive a document reopen (workshared, closed without save): re-Prepare after
  every restart before Detect.
- Editing source while converge is mid-restart → `worker-failed` PDB baseline mismatch → another
  restart. Sequence edits strictly between restarts.
- The experiment flags rewrite `rooms_*.tsv`/`ink_*.bin` in Documents; committed fixtures are
  untouched by Detect. Only `run-takeoff.py` copies TSVs into `eval/`.

## State

Worktree `Pe.Tools-rhvac-room-shapes`, branch `codex/rhvac-room-shapes`, all work UNCOMMITTED
(user commits; note `eval/rhvac/` is still fully untracked — there is no committed baseline until
it lands). Modified this pass: RhvacEval.cs (honest gate), RhvacEvalTests.cs (18 tests),
RhvacCandidateBuilder.cs (area cross-check), Contracts.cs + Detector.cs (RequireCeiling,
SealDoorHeads, SealWallRunGaps, StoryCapFt), run-takeoff.py (LEVEL_POLICY).

The fixture TSV snapshot was REGENERATED under LEVEL_POLICY on 2026-07-24: L0 57 rooms/13,162 sf,
L1 71/20,714, L2 77/14,376, L3 49/5,662 (roof-covered model), Theatre 1/907 (id R01 stable — the
curated match survived). Detected total 54,820 sf vs old 26,823. Final scorecard: curated (gated)
9.8% area / 7.3% cfm; provisional diagnostic 69.7% area / 76.4% cfm (was 38.1/49.3). All old
room-map.notes candidate ids are stale against this snapshot; the notes carry a dated section for
the new ids. Self-tests 18/18 green (the builder count test now derives its expectation from the
TSVs instead of a magic number).

Identity curation has real evidence now: `revit.context.view-image` captures of the labeled
"Mechanical Plan - <Level> West/East/Garage" views + scratchpad `mechoverlay.py` projections were
registration-verified (candidate outlines trace drafted rooms exactly, drafter room names legible
beside candidate ids). The first pass added 4 matches (Golf Sim, Game Room, Main Bar, Her Closet)
at a 9:1 evidence bar and documented its refusals; the biggest curation blockers left are the L2
suite/office cookie-cutter wings (containment unverifiable under dense duct overlay) and the
open-plan blobs, which must never be matched to single oracle rooms.

Ops trap: if the worktree pe-tools host dies (`service list` loses the worktree-sourceRoot entry,
curl refuses), restart it with `pnpm --filter @pe/host dev` from `source/pe-tools` in the worktree;
the service file under `%LOCALAPPDATA%\Positive Energy\Pe.Tools\state\service\` carries the fresh
port + token. Hosts of other checkouts proxy the same bridges but bind their own source roots.
