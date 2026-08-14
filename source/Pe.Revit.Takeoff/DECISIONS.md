# Takeoff decisions

Dated, append-only. Newest batch first. Each entry: what was decided, and the why that makes it stick. Reopen one only with new evidence — and record the reopening here.

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
