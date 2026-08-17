# Takeoff pipeline

PE already draws and issues zoning; Takeoffs makes that drawing the machine contract. Zones bound the solver, rooms become editable Revit geometry with durable identity, Manual J data flows into the `.r10` without transcription, and a revision becomes a diff instead of a redraw. Vocabulary and laws live in [AGENTS.md](AGENTS.md); rationale and tombstones in [DECISIONS.md](DECISIONS.md).

## Pipeline

Each step has one owner and writes to one home. "Op" means a `takeoff.*`/`rhvac.*` host operation.

| # | Step | Owner | Writes to | Leverages |
|---|------|-------|-----------|-----------|
| 1 | Declare zones | designer | Zoning Region FRs on zoning views | FilledRegion; Pe shared params delivered via Detail-Items instance binding |
| 2 | Validate + register | op | role/GUID stamps on FRs; System registry | `SharedParameterBinder`; registry blob on Project Information; tag↔registry resolution with rename-vs-new asked explicitly |
| 3 | Partition (per zone, explicit trigger) | op | Room Region + held/void FRs on first run; a proposal diff on rerun | level-wide capture (cached) masked to the zone → watershed → promotion gate with per-zone frames; accounting closure asserted |
| 4 | Edit | designer | Room Region FRs | Revit's native sketch editor — the edit surface |
| 5 | Room data | designer via web grid | the `.r10` copy | deterministic assists (lighting 0.25 W/sf, people by bedrooms, PE equipment table, OA/exhaust, ERV latent) keyed off room type; closed assembly picker |
| 6 | Export | op | surgical sync into the existing `.r10`; `.r10` link blob on FRs | 32-bit Jet lane; upsert by `Identifier` on geometry-owned fields only; copy → validate → atomic swap + timestamped backup; refuses while RHVAC holds the file; deterministic `SystemNumber`; tag written into the RHVAC system name |
| 7 | Reconcile | op | report only | tag join across `.r10` ↔ zones ↔ equipment (`PE_G___TagInstance`) ↔ FOM workbook |

## Data homes

| Datum | Home | Notes |
|-------|------|-------|
| Zone geometry, name, System tags | Zoning Region FR + Pe params | designer-authored |
| System identity (GUID ↔ tag) | System registry: versioned JSON-blob param on Project Information | rename = registry edit through explicit reconciliation |
| Room geometry | Room Region FR | reshaped only in Revit |
| Room identity, provenance, `.r10` link | Pe params + JSON blob on the Room Region FR | machine bookkeeping; surfaced read-only in the web UI |
| Room type | `PE_M___RoomType` on the Room Region FR | closed vocabulary from the PE equipment table; assists derive from it |
| Manual J room data (people, lighting, equipment, assemblies, ventilation) | the `.r10` | edited via the grid; assists compute, engineer confirms |
| Loads and results | the `.r10` | RHVAC is the calculation authority; no headless calc exists |
| Equipment identity and parameters | `PE_G___TagInstance` etc. on equipment instances | office standard; read-only to this pipeline |
| Manual S selection | FOM workbook | read-only to this pipeline |
| Held data conflicts (e.g. two accepted rooms merged) | marker on the surviving Room Region's blob | the only persisted pending state; blocks export until resolved |
| Pending proposals (unaccepted rerun diffs) | nowhere — session-ephemeral | admissible because reruns are deterministic and every decision writes through immediately |
| Run artifacts (replay, ink, evidence) | project-scoped artifact directory | diagnostics, never state |

## Identity spine

Two tiers everywhere: a stable GUID for machine joins, a mutable human tag or name for display and export. Designers type tags; validate resolves them against the registry and asks when a tag vanishes while another appears (rename vs new System). The equipment↔zone relationship is a tag join computed at query time — no persisted element-to-element links. The `.r10` link is `{file identity, room Identifier}` stored in the Room Region's provenance blob, so revision export matches on `Identifier` instead of fragile name strings.

## Scope

**In**: steps 1–7 above; per-zone conservation metrics; the reconciliation report (the "all in sync" check — it writes nothing).
**Out (for now)**: generating the ManS workbook; writing FOM values back onto equipment; paste-ready xlsx blocks (boundaries of that data need mapping first).
**Prototype before speccing**: the house-as-system views (zone accounting, System tree with the 32k Btu/hr sensible-cap warning). The review surface is settled by the mocked decision-queue shape (see DECISIONS 2026-08-14 review batch): two verbs everywhere — accept takes the recalc's proposal, dismiss keeps the designer's state; data-conflict holds are the only multi-choice rows; shapes change only in Revit. Invariants: proposals never auto-apply; the designer's shape wins until accepted; drift is shown against the accepted state.

Dev-lane is acceptable during build-out, but installability is a standing constraint: no new dependency on `sourceRoot`, scripts resolved package-relative, ops designed as products.

## Feedback loops

Gates are conservation and identity laws — no oracle, no tolerance dial: accounting closes per zone; accepted regions stay inside their zone; reruns re-bind every GUID with zero silent drops; edits survive recalc with zero orphaned decisions; a zone known to contain rooms never vacuously passes by rejecting everything. Diagnostics that carry the tuning gradient but never gate: promotion/rejection histogram (rejections carry their magnitudes — a tolerance refusal states what the tolerance would have had to be), ink-backed edge fraction, held/void fractions, per-zone disposition render. Coverage %, IoU, and junk-vs-real are retired (see DECISIONS.md).

Tuning has its own currency on top of the gates: `eval/rhvac/score-looks-good.py` board **savedWork** is the number to beat (per-zone recall / edge-on-ink / swallowed-wall-sf / edit-cost carry the gradient), and the honesty bar is **per-room** — no previously-accepted room's own edge-on-ink may fall beyond ~0.005 noise; zone and board means are diagnostic only (dilution by honest newcomers is a statistical artifact). The standing brief is [docs/features/takeoffs/TUNING.md](../../docs/features/takeoffs/TUNING.md); kaitpw A/B verdicts land in the tuning worktree's TASTE.md and outrank any proxy metric. Per-zone fixtures derive from `eval/rhvac/project-a/zones-mech.json` — 45 real designer-drawn zones; the room-bearing ones are partition fixtures, the empty ones are abstention fixtures.

## Proof obligations

Live-unproven assumptions — probe each in a scratch document before building on it:

- **FR shared-param write round-trip — PROVEN live 2026-08-14** (DECISIONS): our own `SharedParameterBinder` Detail-Items instance binding writes and reads back on project-a FRs (all 9,212 carry it); `TakeoffCarriers` is the productized module, live-verified including registry blob round-trip and reconciliation. Residual: survival across save/sync/reopen is standard Revit project-param behavior, spot-check on first synced model.
- **FR boundary read-back under user editing** — arcs, splines, self-touching rings drawn by hand must hit STRAIGHT-ONLY enforcement at read time.
- **Registry blob capacity — PROVEN to 1 MB live 2026-08-14**: a 1,048,571-char string round-trips on a hidden Project Information text param; orders of magnitude above any realistic registry.
- **Capture cache** — per-zone runs are only cheap if the level-wide raster capture is shared and keyed by document/level/capture-options hash.
- **`.r10` upsert round-trip** — Jet layer PROVEN 2026-08-14 (`eval/rhvac/project-a/UPSERT-PROBE.md`): row-level UPDATE/INSERT side-effect-free, zero foreign keys, lock refusal exercised; `Rhvac/sync-rhvac.ps1` is the safety envelope. Residual: a human on an RHVAC box must confirm the app opens and recalcs a synced file. Schema facts: `Room` PK is `Number`; `Identifier` is an autonumber COUNTER — never supply it.

## Inheritance

The partition interior survives from the whole-level engine: capture stack (`ProjectionSeed`, `Heightfield`, `DetectSnapshot` with its capture-baked honesty boundary), watershed partition, shared-coverage regularizer, and the promotion gate (`FrameLocalProjector`, `TakeoffEditability`, `TakeoffEvidenceFidelity`), hardened by the 2026-08 tuning rounds (DECISIONS.md carries the numbers and tombstones): diagonal-honest sealing (scan thresholds honored in feet on every direction), the door-head width bound (`DoorHeadMaxComponentFt`; oversize lintel components seal only their fringe and never back a boundary), drift priced in world-axis L∞ against the de-staircased reference (rotated frames pay what orthogonal ones pay), zone-clip squaring plus the zone-fit repair composite (squarer + fenced de-jog + debris-run collapse, one displacement budget, unmodified audit re-judges), the snap-never-sweeps-across-ink guard, and unbacked-separator absorption (a door is an opening, not a wall). The adversarial waves shrank the machine: six perturbation-inert knobs and the dead LevelProfile seed rule deleted; `AdaptivePolicy` stays as an empty, contract-tested seam. The RHVAC lane (`Rhvac/*.ps1`, candidate builder, eval round-trip checks) carries forward unchanged. The Spaces-primary materialization path (`SpaceMaterializer`, the native-Space readback/audit verbs on `RoomTakeoff`) and the C# resolutions sidecar (`TakeoffResolutions`) are **deleted** as of the solver re-eval phase 1; the TS twin under `apps/web` still exists. Everything that inferred scope (crop heuristics, border flood, border residue, junk-vs-real flags, level-wide profiles and frames) and the coverage-era scorers is scheduled for deletion — the census and rationale are in DECISIONS.md.
