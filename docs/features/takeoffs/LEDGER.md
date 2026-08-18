# takeoffs ledger

## Decided
- 2026-08-14 — SyntheticBands seed ink stays PRIMARY; ZoningPlanDwg (stripped `A_WALL*`/`A_XWALL`/`A_GLAZ` DWG export) is an opportunistic per-project accelerator only — topology-agnosticism is the point of the raster lane. (Verified lane recipe, if ever built: [dwg-ink-recipe.md](dwg-ink-recipe.md).)
- 2026-08-14 — Zone boundary is authority, ink is evidence: room edges snap/clip to the zone line (zone-fit stage), never argue with it; ink disagreement gets a drift budget instead.
- 2026-08-14 — Solver defaults settled by A/B sweep: SmallZoneSqft 750, InkClusterWhiteoutCells 100, frame drift 2.5 ft/0.20, Hybrid seeds; knobs+hash serialized into report.json so runs are self-describing.
- 2026-08-15 — FR is the proposal medium (no diff-view proposals); blob-only decision authority, no sidecars; template `.r10` never pipeline-owned, sync targets a copy; adoption is explicit multi-select, legends ignored.
- 2026-08-15 — `fileIdentity` for `.r10` is sha256 over titles (schema has no GUID); all four parts returned so callers detect drift instead of trusting a match.
- 2026-08-15 — Unknown assemblies fall back to a zero row + `assemblyFallbacks` report instead of throwing; a zero-wall-load room is a real hazard callers MUST surface.
- 2026-08-16 — Manual J columns stay `NumberCell` by judgment — do not re-litigate unless `StateCell` grows numeric commit. (The design-language rulings this pass landed are owned by the design-system ledger.)
- 2026-08-16 — Tuning honesty bar is per-room: no previously-accepted room's edge-on-ink may fall beyond ~0.005; zone/board averages are diagnostic only. Raise coverage by improving geometry, never by loosening gates.
- 2026-08-16 — Oracle v1.1 adopted: 25/118 oracle rooms are phantoms/duplicates (guest-house PDF misregistered + duplicated floor-2 pages); dedupe hygiene measured savedWork 0.3916→0.3957.
- 2026-08-17 — Round-3 tuning complete on worktree `room-solve-tuning@ead263a` (UNMERGED): board savedWork 0.334→0.432; measure suite = score-looks-good.py + conservation gates; kaitpw verdicts in TASTE.md outrank any proxy metric.

## Tried & rejected
- 2026-08-14 — Verbatim zoning-plan pixels as seed ink: walls share the halftone gray band with clutter, ~1,200 annotation clusters, 8.5% color fill — separation would rebuild the whole pipeline with less control.
- 2026-08-14 — Second-pass rescue ladder: drift magnitudes prove failed rooms don't fail narrowly; re-projecting in different company fails the same way. Miss attribution (RejectionDetails drift magnitudes) is what survived.
- 2026-08-14 — Evidence weights (CeilStep*/FloorStep*/BoundaryEvidenceMin): structurally dead with band-composed ink — re-scoring one signal against itself; revisit only with DWG ink.
- 2026-08-14 — Adaptive per-zone gating default-on: costs 6 rooms/115 sf under the relaxed drift budget that obsoleted its calibration; seam kept, rule off. Absorb 0.30 is a per-zone lever, not a default (net −3 globally).
- 2026-08-14 — IoU/coverage scoring stays retired; oracle survives as non-vacuous count (now "looks good" board in tuning).
- 2026-08-16 — Gate loosening for mixed-frame rooms (ML09): proven useless — 1 of 5 converts at drift 6.0, refusals just rotate; the real mechanism is segment-wise frame assignment (round-4 design item).

## Owed
- Merge or harvest worktree `room-solve-tuning@ead263a` (score suite, oracle v1.1, TASTE.md, TUNING.md round-4 backlog) into main.
- Round-4 tuning: unify zone/room edges that run parallel to ink by snapping ALONG the ink line, not just across it.
- Round-4 tuning: design segment-wise frame assignment for mixed-frame rooms (ML09) — gate loosening is proven useless here.
- Round-4 tuning: the door-head sealer manufactures backing over low ceilings (LL08) — bound or condition it.
- Round-4 tuning: persist door-head seals separately from wall-run seals (INKP v4) so they can be tuned independently.
- Stale `ink_*.bin` lane — repair it or delete it; `review-takeoff.py` still reads the ink bins.
- Knob census: ~70 solver knob fields exist with no inventory of which are load-bearing.
- Promote the `scripting.execute` takeoff pipeline to installed `takeoffs.*` host ops; that also owns replacing the dev-only 32-bit script spawn.
- Pre-sync Manual J drafts have no persistent home — they are session-ephemeral today.
- Exposures are not evidence-backed: glass/doors come out empty and roof/wall direction is coarse.
- Per-project custom assemblies need a design — today's preset catalog is one project's vocabulary hard-coded for everyone.
- Updates-lane sync is unwired from the panel (insert-only); drift reconciliation by stored Identifier exists at the op layer but no UI reaches it.
- Live `sensibleBtuh` is always 0 until a reconcile lane exists.
- Stale-world indicator is unwired — `useWorldLog` exists, nothing renders it.
- Registry rename-vs-new reconciliation is unreachable from the UI.
- `ceilingFt` silently defaults 0→8 for regions with no session run.
- Zone loops tessellate arcs to chords, so a hand-drawn curved boundary silently loses its arcs.
- MaterializeAccepted: one-click accept for unhomed proposals.
- `takeoffs.sync` as an atomic op.
- Move geometry + assembly math out of the route.
- Fixture-scaffolding hygiene prunes.
- Lower Level oracle registration is UNTRUSTED (median 1.95 ft chamfer, floor-mapping suspect).
- Main 10 has 0 in-zone oracle rooms — cheap to resolve.
- ZoneSnapFt=1.0 buys one room on project-a — re-measure or retire the knob.
- `LevelProfile` region-cores rule silently subsumed by the Hybrid `SeedSource` default — make the rule or the default explicit (comment at the site, LevelProfile.cs).
