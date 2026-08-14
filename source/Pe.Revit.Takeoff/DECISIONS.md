# Takeoff decisions

Dated, append-only. Newest batch first. Each entry: what was decided, and the why that makes it stick. Reopen one only with new evidence — and record the reopening here.

## 2026-08-14 (live Revit) — FR carriers and registry blob proven; TakeoffCarriers live-verified

Live-probed in the project-a cloud clone (Revit 2025, dev payload) via `scripting.execute`:

- **FR shared-param write round-trip PROVEN.** A text param bound through our own
  `SharedParameterBinder` (instance binding, Detail Items category) landed on all 9,212
  FilledRegions; set + Regenerate round-trips in-transaction and reads back identically from a
  separate later call. The persistence-layer hypothesis under every data home is now fact.
- **Registry blob capacity PROVEN to 1 MB** on a hidden Project Information text param
  (1 KB / 32 KB / 256 KB / 1 MB all round-trip byte-identical).
- **`TakeoffCarriers` live-verified**: EnsureBindings + WriteIdentity/ReadIdentity +
  provenance blob on a real FR; System registry write/read through the fail-closed codec;
  `Reconcile` on live data surfaced the rename question correctly (vanished FC-13 + appeared
  WS-1 = 1 candidate pair). Pe.Revit.Takeoff gained its one ProjectReference (Pe.Revit) for the
  binder — the sanctioned persistence path; the library stays otherwise leaf.
- Residual: carrier survival across save/sync/reopen is standard Revit project-param behavior;
  spot-check on the first model that syncs. Probe params (`_PE_TakeoffProbe*`) live only in the
  unsaved clone session.
- Ops note: adding a new source file (or any csproj change) puts hot reload into
  restart-required by design — converge --restart cycles Revit and drops open documents; reopen
  via `revit.apply.document.open`. Not an SDK bug.

## 2026-08-14 (live RHVAC) — surgical sync accepted and recalculated by RHVAC 10

Live-probed in Elite RHVAC 10.01.57 on a disposable copy of projectA. `sync-rhvac.ps1`
updated only Room Identifier 1: name `Golf Sim 005` → `Golf Sim 005 SYNC PROBE` and area
1485 → 1600 sf. RHVAC opened the output without a repair/conversion error; its Room Data view
showed the new name and area. Opening Load Preview recalculated the project, and saving persisted
the fresh results.

- Building area moved exactly +115 sf, 51559.8008 → 51674.8008.
- System 1 cooling net load moved +47 Btuh, 4009.5569 → 4056.5569; heating load moved
  +102 Btuh, 7604.6611 → 7706.6611. Its fixed actual airflow remained 600 CFM.
- Building cooling net changed 488173.4375 → 486648.9375 and heating changed 483396.625 →
  483498.625. The building cooling direction is not attributable solely to this room because the
  full RHVAC recalculation refreshed project-wide previously persisted results; the edited
  system's heating and cooling both moved upward as expected.
- A fresh extract found all 149 other rooms' modeled inputs projection-identical to the
  pre-open synced file. No calculation error was reported.

This closes the RHVAC-open/recalculation residual for surgical UPDATE. The optional orphaned
`SystemNumber` and `DefaultRoom`-clone INSERT live probes remain unrun; they do not block the
proven update path.

## 2026-08-14 (later) — the review surface and the `.r10` reversal

Settled in a mock-driven session (decision-queue mock v2, judged against the live `/rhvac` plan-pane pattern).

- **Pending proposals are session-ephemeral; decisions write through.** The review surface holds no batch-commit state: every accept/dismiss is an op persisting to the datum's home at click time, and the solver's determinism (same model + zone + constants → same proposal) makes a lost session cost one rerun, never a decision. This deleted the "proposal blob" idea before it was born — an ephemeral queue is admissible precisely because nothing pending accumulates.
- **Held data conflicts are the one persisted pending state** — a marker on the surviving Room Region's blob, because export-blocking state cannot be session-scoped. Removals do not hold: confirming a removal orphans the room's `.r10` data with a stale flag rather than deleting it.
- **Two-verb review vocabulary.** accept = take the recalc's proposal, dismiss = keep the designer's state, uniform across shape/new/removal/drift rows; merges are the only multi-choice row. Mirrors the surviving `plan-pane.tsx` FlagQueue — one row per decision, inline verbs, no cards, no severity taxonomy. Web UI carries no geometry verbs (reaffirming the purge); shape work deep-links to Revit.
- **Drift is measured, not forbidden.** Closure is a partition-time invariant; hand-edit drift reports against a project-constant threshold (starting 20 sf — a constant in one place, not a UI lever) and blocks export only above it. Edge-snap reconciliation arrives as a rerun proposal row, never silently.
- **The zone is the rerun unit; no sub-zone rerun, no exposed knobs.** Partial accept is free (rows are independent); accepted rooms are pinned by GUID re-binding so a zone rerun cannot disturb them — granularity without a dice lever. Determinism is the anti-dice-rolling law: rerunning an unchanged model returns the identical proposal. A designer needing per-zone constant tuning is a promotion-gate bug to file, not a knob to expose.
- **REOPENED: export "never in place" (set earlier today) → surgical sync.** New evidence: remaking the file violates one-home-per-datum — the `.r10` is the home for Manual J data *and* for RHVAC-native edits this pipeline will never model (equipment picks, duct settings, overrides), all destroyed by a remake; and file-identity churn was rotting the `{file identity, Identifier}` link every export. New shape: upsert by `Identifier` on geometry-owned fields only, insert new rooms, park removals stale, touch nothing else. Safety survives as copy → validate → atomic swap + timestamped backup ("never destructively" replaces "never in place"). New proof obligations (README): Jet upsert round-trip that RHVAC still opens and recalcs; lock detection; plus an adoption path for pre-existing files (match by name once, then `Identifier` forever).

## 2026-08-14 — the zone-bounded spec

Settled in a grilled design session against five audits (feedback loops, architecture, UI, git-history census, four-surface project-a reconciliation) plus the firm's Manual J training deck.

- **One home per datum is the governing law.** Split-brain state (the resolutions sidecar and its independently-implemented TS twin; Spaces vs detector TSVs as competing writable geometry) caused silent work loss in the prior era. Every datum gets exactly one authoring home; all else is projection.
- **Detector domain is the Zoning Region, not the level** (inherited from the pivot, restated as binding). Coverage % against a level is retired — the ceiling was engineer intent, not geometry. Whole-level entry points survive only as convenience wrappers, if at all.
- **No extensible storage — repo-hard rule.** Broken ES schemas can crash Revit. Sanctioned carriers: Pe shared parameters bound through `SharedParameterBinder`, and versioned fail-closed JSON-blob parameters (the `_PE_ParameterLinksProfile` pattern). Known legacy exception: Autotag, to be unwound (likely onto Parameter Links). Takeoff's own `PeTakeoffOwnership` ES fallback in `SpaceMaterializer` gets deleted with the Spaces-primary path.
- **FR carrier: Pe shared params via Detail-Items instance binding.** Live-probed in the project-a clone (Revit 2025): `OST_FilledRegion.AllowsBoundParameters == false`, but the architect's own `Filter`/`Graphics Filter` shared params — instance-bound to a ~100-category set including Detail Items — appear writable on FR instances. `Mark`/`Comments` stay free for humans. Write round-trip is a standing proof obligation (README).
- **System is a first-class entity**: stable GUID + mutable user tag, in a model-owned registry blob on Project Information. project-a evidence forced this: the `systemNumber ↔ FC-n` binding existed only as hand-typed prose in one xlsx cell; tags were renamed mid-project (IU→WS) leaving the issued legend stale; multi-tag zones (`FC-8, FC-13`) and cross-level systems (FC-6, FC-9, FC-17) are ~15% of the project. Zones carry tags (human-authored); validate resolves against the registry; a vanished+appeared tag pair is asked about explicitly — rename or new system — never guessed.
- **Equipment ↔ zone is a tag join at query time.** Equipment already carries `PE_G___TagInstance` (office standard; nothing in this repo writes it). No persisted element-to-element links: the Parameter Links engine's relationship model is a closed topology enum, and a declared-edge graph store is the wrong machinery for what a join over two parameter sets answers. Validate reports dangling tags on both sides — which would have caught project-a' phantom `IU-2` and the unparsed `UH-2-4` range form.
- **Reruns are explicit, per zone. Nothing watches for architectural change.** Arch revisions arrive as relinked models with possibly shifted coordinates; deciding "things moved" is the designer's call (zone redraw or explicit rerun), not an automatic diff — automating it would smuggle in design decisions nobody asked for.
- **Recalc proposes; the designer's shape wins until accepted.** The prior era's native-readback lane silently discarded human decisions when Revit edits superseded them — the trust-destroying default. Geometry merges are proposals; data merges (two accepted rooms with `.r10` data collapsing into one) are held unresolved and block export.
- **Room type lives on the Room Region FR** (`PE_M___RoomType`, closed vocabulary from the PE equipment table). It is upstream input that must survive revisions; the `.r10` holds only derived values (people, equipment Btuh); the assists are the deterministic function between them. Grid shows it with provenance and writes back through an op.
- **`.r10` room link = `{file identity, Identifier}` in the Room Region provenance blob.** `Identifier` is an RHVAC autonumber PK meaningful only against one file — pairing prevents silent rot on file swap. The prior string join (`{number}-{name}`) survived project-a 150/150 only because nothing had been renamed yet.
- **Spaces are out of the critical path.** Nothing between zone declaration and `.r10` export needs one; the project-a clone's only spatial elements were 61 orphaned `PE-TAKEOFF` Spaces from an old run. A derive-spaces op stays open as a future feature (Revit-native capabilities, real 3D geometry).
- **Scope calls**: reconciliation report in, and it writes nothing — minimal blast radius while trust builds. FOM→equipment write-back out of v1 (uncomfortable making equipment writable from this pipeline yet). ManS workbook generation out; its `Load Preview Data Link` table recombines RHVAC paste + FOM + cutsheet data whose boundaries aren't mapped yet. Review-surface and system-view UI shapes go to prototype, not spec — same phase as the old-code purge and arch revamp.
- **Dev-lane build-out, installability as constraint.** Real promotion is premature at this maturity, but no new `sourceRoot` dependencies and package-relative script resolution from day one, so shipping is packaging rather than rework.
- **Metrics: conservation gates, not scores.** Five oracle-free gates (accounting closure, scope containment, identity stability, edit preservation, no vacuous pass) + non-gating diagnostics. The old scorer's gates failed permanently by 2–4× and two actively rewarded falsified behavior (count-ratio rewarded open-plan blobs; zero-junk punished the flag-don't-reject law).

## Inherited from the whole-level campaign (2026-06 → 2026-08)

Laws with their earned evidence, so nobody relitigates:

- **STRAIGHT-ONLY** — curve/hole ambition shipped diagonal artifacts across whole plans; removed wholesale 2026-07-12.
- **Drop, don't mangle** — a missing room is one human fix; a warped polygon is un-diagnosable.
- **Editability over area fidelity** — raw raster staircases made FRs literally un-editable (one editable wall of 82); straightened-but-drifted edges are rejected, not shipped.
- **Flag, don't reject** — the width threshold that kills narrow junk also kills a real 31.9-sf mech room; junk/real is geometrically inseparable at 0.25-ft cells. Only ceiling-height variance earned junk-flag status (93.4% precision, 71% recall).
- **Identity must be geometric, never rank** — `R{rank}` ids reshuffle on any rerun; label-point + area ±20% re-anchored 100% on a shuffle fixture.
- **Counts aren't proof** — every claim pairs a plan-image checkpoint with a deterministic census.
- **Boundary convention (locked 2026-07-03)**: centerline on interior partitions, outside-face on envelope — matches the firm's taught ASHRAE measuring rule exactly; finish-face undershoots real areas 15–25%.
- **Rooms are one shared coverage** — per-room repairs can't agree on shared edges; simplify all rooms together so a shared edge gets one identical replacement.

Falsified — do not re-try (each implemented and measured; the number is the tombstone):

- Vector wall harvest: 47.7% recall vs raster 51.9%.
- Typed IFC openings: all 55,634 imported objects untyped proxies.
- Finer cells (1.5-in/1-in): no junk/real separation window at 4.4–10.8× cost.
- Junction pairing by owner identity: 87→84 failures, needed ≤35.
- DistanceMaxima seeding: under-seeds closets/baths (41.9 vs 52.8); hybrid wins.
- Pure-shape junk flags: 97.4% precision at 30% recall — useless alone.
- MinCompactness as room-killer: amputated 86% of a level's area.
- Machine-straightness ceiling: 23.5% of rooms regularize under a 3% area-honesty contract — the rest is exactly the human hand-editing the zone-bounded flow assumes.
- Coverage %/mean IoU as goals: saturated ~0.54 against fuzzy oracle registration, circular by construction ("area-matched then area-scored").
- Native readback as canonical (P9, built then reversed): hand-edited Spaces flowing back as truth recreated competing writable state; the instinct (human edits win) was right, the artifact was wrong — it now lands on Room Region FRs.
