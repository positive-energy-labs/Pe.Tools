# /runs — open stand-ins

The ledger of what the run browser fakes, approximates, or cannot say. Every `// gap (SHIMS.md
#N)` comment in `src/runs/` points here. A shim closes when the fix lands where it belongs — for
most of these that is **persist time in the C# harness or the python scorer**, not a recompute in
TypeScript. The browser reads a run package; it does not re-derive one.

Opened at round-2 close, 2026-08-17.

---

## 1. `scores.json` is not part of the run package

**What is true:** the harness persists `report.json` + zone TSVs + INKP bins. The scorer's board
(`savedWork`, `roomRecall`, `heldRecall`, `edgeOnInk*`, `swallowSf`, `meanEditCost*`) comes from
`eval/rhvac/score-looks-good.py score <report.json> --out scores.json`, run by hand. Two of the
seven pool runs happen to carry a `scores.json` because someone pointed `--out` at the run
directory; five do not. A file that exists only when a human remembers is not a contract.

**What it blocks:** `world.boardSummary` and the ledger dock stop at report.json facts — solved
zones, accepted rooms, accepted/held sqft, the rejection histogram's head. No savedWork column, no
ranking runs by saved work, no "did the score actually move" answer on this page.

**Where the fix lives:** persist time. Either the harness invokes the scorer at the end of
`ZoneBoundedDetectTests.ProjectA_zones_partition_within_declared_scope` and drops `scores.json` into
the run directory, or the scorer's board joins `report.json` itself. Not a TS recompute — the
scorer is the measure's authority and there must be exactly one of it.

## 2. Zone identity is positional across runs

**What is true:** `Zone` ("Main Level#03") is an ordinal assigned during zoning. Nothing in the
package ties a zone in run B to the same geography in run A.

**What it blocks:** the A/B pairing matches zones by name, so if the zoning itself moved between
runs the sheet can put two different rooms-worth of building side by side and call it a delta. The
surface cannot detect this, and therefore cannot warn about it.

**Where the fix lives:** a stable zone key (bbox hash, or a seeded id carried through zoning) in
`report.json`. Then A/B pairs on identity and orphans on both sides read as orphans.

## 3. TSV rooms carry no accepted/held flag

**What is true:** `ROOM` lines in `zones/rooms_*.tsv` carry id, sqft, and a label point — no
disposition. The accepted/held split exists only as counts in `report.json`.

**What it blocks:** the SVG overlay draws every TSV room in the accepted tone. Held rooms are
visible as numbers, never as geometry — you cannot see *which* rooms the run held. The python
renderer works around this with its own convention; the two renderers therefore disagree.

**Where the fix lives:** the disposition joins the TSV at persist time. The convention currently
living in the python renderer should become a persisted column.

## 4. Overlay-diff A/B needs per-run room masks

**What is true:** A/B is side-by-side, which is the ruled default and is not itself a shim. The
*overlay* diff — kaitpw's sketch of clever fills for both / A-only / B-only — is not built.

**What it blocks:** nothing today. It is deferred until the diff story is designed, and it needs
per-run room masks (rasterized room coverage) that no one produces yet.

**Where the fix lives:** design first, then persist-time masks or a client-side rasterization of
the TSV polygons. Do not build the masks before the story.

## 5. Revit export images as an alternate underlay

**What is true:** the underlay is the run's own INKP bins — the evidence the solver actually
consumed, which is the point of the underlay law. Revit export images would show what the drawing
*looks like* rather than what the solver *saw*.

**What it blocks:** nothing. Deferred at kaitpw's call ("some point later"). **Owner: kaitpw.**

**Where the fix lives:** an export step in the harness plus a second underlay source in
`world.ts`. If it lands, it is an *alternate*, never a replacement — muting the real evidence
behind a pretty picture would break the honesty semantics the whole surface rests on.

## 6. `paintRaster` has no speck filter

**What is true:** the python renderer suppresses closure components under 0.25 sf. `paintRaster`
paints every set cell, so single-cell closure speckle shows up in the browser and not in the
contact sheets.

**What it blocks:** pixel-level agreement between the two renderers, and a little visual noise in
ink-starved zones. The muting keeps it tolerable; it is not a correctness problem.

**Where the fix lives:** a connected-component pass in `world.paintRaster`, or — better — the
harness not emitting sub-threshold closure cells in the first place. Whichever way it goes, the
two renderers should stop disagreeing about what a closure looks like.

## 7. The registration primitive is zone-shaped, not bounds-shaped

**What is true:** `world.zoneViewport` takes a `ZoneRecord` and pads its bbox. The plan dock needs
a whole-level viewport, so `browser.tsx` builds one by hand from the same `ZoneViewport` struct —
`toPx` / `ringPath` / `paintRaster` then apply unchanged.

**What it blocks:** nothing functionally; it is a shape smell carried from round 1. The primitive
wants to be bounds-first with `zoneViewport` as a convenience on top.

**Where the fix lives:** `world.ts`, whenever a third caller makes it worth the churn.

---

## Closed at round-2 close

- **`adaptedKnobs` — NOT a shim.** It was read untyped through a cast. Inspection of the pool and
  of `ZonePolicy.cs` settles it: `adaptedKnobs` is persisted on **every** zone as
  `IReadOnlyDictionary<string, string>`, and it is empty on every run in the pool because the
  adaptive-policy seam carries **no live rules** (`Contracts.cs: AdaptivePolicy = false`; the
  sparse-wall rule and its keying signal were both falsified and deleted 2026-08-16). It is now
  typed `Record<string, string>` on `ZoneRecord`. Empty is a fact about the solver, not a missing
  field — the card correctly shows nothing.
- **Pool identity.** The run-pool server already reported `pool` alongside `runs`;
  `fetchRunIndex` was throwing it away. It now returns `RunPool` and the surface states the
  absolute directory it read — in the ledger dock, and in the empty state where it matters most.
- **Empty pool.** Was a bare sentence; now a real empty state that tells the system story (the
  pool fills itself when the harness test runs) rather than a filter story.

## Naming correction

The pool server is described in several places as the vite middleware `pe:takeoff-runs-pool`. It
is not a vite plugin — it is the TanStack Start API route `src/routes/api/runs-data.$.ts`, serving
`/api/runs-data/*`. The name survives as a role, not a location.
