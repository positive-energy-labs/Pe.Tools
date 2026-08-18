# takeoffs ledger

## Decided
- 2026-08-14 — SyntheticBands seed ink stays PRIMARY; ZoningPlanDwg (stripped `A_WALL*`/`A_XWALL`/`A_GLAZ` DWG export) is an opportunistic per-project accelerator only — topology-agnosticism is the point of the raster lane. (Verified lane recipe, if ever built: [dwg-ink-recipe.md](dwg-ink-recipe.md).)
- 2026-08-14 — Zone boundary is authority, ink is evidence: room edges snap/clip to the zone line (zone-fit stage), never argue with it; ink disagreement gets a drift budget instead.
- 2026-08-14 — Solver defaults settled by A/B sweep: SmallZoneSqft 750, InkClusterWhiteoutCells 100, frame drift 2.5 ft/0.20, Hybrid seeds; knobs+hash serialized into report.json so runs are self-describing.
- 2026-08-15 — FR is the proposal medium (no diff-view proposals); blob-only decision authority, no sidecars; template `.r10` never pipeline-owned, sync targets a copy; adoption is explicit multi-select, legends ignored.
- 2026-08-15 — `fileIdentity` for `.r10` is sha256 over titles (schema has no GUID); all four parts returned so callers detect drift instead of trusting a match.
- 2026-08-15 — Unknown assemblies fall back to a zero row + `assemblyFallbacks` report instead of throwing; a zero-wall-load room is a real hazard callers MUST surface.
- 2026-08-16 — Design-language rulings landed (StateColumn.word, `fresh:"never"` rung, verb refusal in title, `--r-ink` selection mark on plans); Manual J columns stay `NumberCell` by judgment — do not re-litigate unless StateCell grows numeric commit.
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
- Round-4 backlog (TUNING.md in that worktree): parallel-on-ink zone/room edge unification (snap ALONG ink); mixed-frame room projection design (ML09); door-head sealer manufactures backing over low ceilings (LL08); persist door-head vs wall-run seals separately (INKP v4); stale `ink_*.bin` lane — repair or delete; knob census (~70 fields); review-takeoff.py still reads ink bins.
- Promotion shims (ex-SHIMS.md): promote scripting.execute pipeline to installed `takeoffs.*` ops (also owns replacing the dev-only 32-bit script spawn); pre-sync Manual J draft home (session-ephemeral today); evidence-backed exposures (glass/doors empty, coarse roof/wall direction); per-project custom assemblies design (preset catalog is one project's vocabulary); updates-lane sync unwired from panel (insert-only; drift reconciliation by stored Identifier exists at op layer); live `sensibleBtuh` always 0 until a reconcile lane exists; stale-world indicator unwired (`useWorldLog` exists); registry rename-vs-new reconciliation unreachable from UI; `ceilingFt` 0→8 default for regions without a session run; zone loops tessellate arcs to chords (hand-drawn curved boundary silently loses arcs).
- MaterializeAccepted (one-click accept for unhomed proposals); takeoffs.sync atomic op; geometry+assembly math out of the route; fixture-scaffolding hygiene prunes.
- Lower Level oracle registration UNTRUSTED (median 1.95 ft chamfer, floor-mapping suspect); Main 10 has 0 in-zone oracle rooms — cheap to resolve.
- ZoneSnapFt=1.0 buys one room on project-a — re-measure or retire the knob.
- Design-audit #11 primitive edits (for the cell-scale ruling session): `stateColumn` drop hard-coded `text-cat-clay` for `--r-alarm`; narrow `StateMeta.tone` to a meaning-role union (four-line diff preserved in `b52d891`). Moot if `stateColumn` dies via `StateColumn.word` migration.
- Design-audit #2: no axis for "a human decision is queued here" — rule it a row fact and build the SURFACE-PHILOSOPHY §4 gutter marker (count + locate), or add an `owed` axis; the flags column stays hand-rolled until then.
- `LevelProfile` region-cores rule silently subsumed by the Hybrid `SeedSource` default — make the rule or the default explicit (comment at the site, LevelProfile.cs).
