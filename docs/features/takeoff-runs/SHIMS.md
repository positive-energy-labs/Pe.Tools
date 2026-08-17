# /runs — open stand-ins

The ledger of what the run browser fakes, approximates, or cannot say. Every `// gap (SHIMS.md
#N)` comment in `src/runs/` points here. A shim closes when the fix lands where it belongs — for
most of these that is **persist time in the C# harness or the python scorer**, not a recompute in
TypeScript. The browser reads a run package; it does not re-derive one.

Opened at round-2 close, 2026-08-17.

---

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

## Closed at the de-shim pass, 2026-08-17 (kaitpw ruling: "no shims should exist in the ui")

- **#1 `scores.json` joins the run package at persist time.** The harness
  (`ZoneBoundedDetectTests.PersistScores`) invokes
  `python eval/rhvac/score-looks-good.py score <runDir>/report.json --out <runDir>/scores.json`
  after copying the package; the python scorer stays the single measure authority and a machine
  without python degrades to an honest gap (console warning, no scores.json, never a failed gate
  run, never a TS recompute). The pool was backfilled by running the scorer against every
  persisted report.json — including refreshing the two files written by the pre-v1.1 scorer, so
  every package now carries the v1.1 board plus `boardV1RawOracle`. UI: `world.loadRunScores`
  (404 = explicit `null`), savedWork v1.1/v1 + roomRecall + edgeOnInk on the board header and as
  ledger columns, currency-matched Δ savedWork (vs A in the header, vs the chronological
  predecessor in the ledger), and a run without the file says **no scores.json** — never a
  computed stand-in.
- **#2 Stable zone identity.** report.json is now SchemaVersion 4: every zone carries `zoneKey` =
  first 12 hex of sha256 over `level|bbox` with the bbox quantized to 0.5 ft
  (`ZoneBoundedDetectTests.ZoneKey`). Nothing ordinal goes into the key, so re-zoning
  REORDERINGS keep identity while an actual geography move changes it — which is exactly the
  event pairing must refuse to paper over. `world.pairZones`/`matchZone` pair A/B on the key
  when BOTH packages are fully keyed, with unmatched zones rendered as orphans (no name rescue);
  name pairing survives only as the pre-key-package fallback and every such card carries a
  visible "paired by name — pre-key package" caveat chip.
- **#3 Room disposition is a persisted TSV column.** The promoted TSV's `ROOM` lines now carry an
  8th column (`accepted`), written because `TakeoffPromotion.Close` marks the result
  (`TakeoffResult.DispositionsResolved`); raw detector TSVs stay 7-column and honestly
  disposition-less. Held rooms were ALREADY persisted per-room as `META residue … rejected` lines
  (`MoveToRejectedResidue` keeps id + geometry; `HeldRooms` is literally the count of Rejected
  residues), and both renderers already drew them in the held tone — the round-2 ledger
  overstated that part. What was real: "ROOM = accepted" lived as a convention in readers'
  heads, not in the package. Now the column says it, `TakeoffTsv`/`world.parseZoneTsv` parse it
  (unknown token = parse error), and a 7-column ROOM line renders in an explicit
  **disposition-unknown** treatment (neutral gray, dashed, tooltip naming the pre-column package)
  on cards, zone peek and plan — never defaulted to accepted.

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
