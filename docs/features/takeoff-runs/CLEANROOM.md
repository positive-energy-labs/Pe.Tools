# /runs clean room — dev-only takeoff result browser

Living doc for the find-the-product loop on the run-history surface. Dev-only tool: prod
standards do not hold, but the design system does (COLOR-ROLES tokens, canon primitives where
they fit). No surface has to catch up to this one; this one borrows freely from the atlas.

**What it replaces (precedent):** the eval contact sheets + hand-run `compare-zone-runs.py`
A/B panels. What confuses about the precedent: pixels-only (solves not inspectable), runs exist
only if hand-snapshotted before the next test wipes them, A/B requires a terminal invocation,
and until 2026-08-16 the renderer hid what was solver input vs invention.

## Settled before round 1 (kaitpw grill, 2026-08-16)

- **Run pool**: every harness run auto-persists to `.artifacts/takeoff-runs/<stamp>-<optionsHash>/`
  (`PE_TAKEOFF_RUNS_DIR` overrides; wipes are acceptable losses). Hook lives at the end of
  `ZoneBoundedDetectTests.ProjectA_zones_partition_within_declared_scope`.
- **Underlay**: the run's own rasters — received ink solid, invented closures screened —
  drawn to canvas from the package's INKP bins; rooms/residues/zone boundary are SVG on top.
  **Deferred (owner: kaitpw, "some point later")**: Revit export images as alternate underlay.
- **A/B**: user picks two runs; **side-by-side is the default**. Overlay-diff is low priority
  until the diff story is figured out (kaitpw sketch: clever fills — both / A-only / B-only).
- **Round 1 = 3 variants**: `sheet` (contact-sheet grid of zone cards), `ledger` (runs-as-table
  first, master-table canon), `light` (whole-level spatial light-table, atlas-like).

## Shared infrastructure (fixture — builders read-only)

- `src/runs/proto/world.ts` — run index, report/tsv/INKP loaders + caches, model→px transform,
  raster painter with the screened-closure treatment, board summary.
- Vite dev middleware `pe:takeoff-runs-pool` (vite.config.ts) serves `/runs-data/*`.
- Route `src/routes/runs.tsx`, `?variant=sheet|ledger|light`, switcher deliberately off-system.
- Real fixture: three runs seeded from round-1 tuning snapshots (baseline-fresh, incumbent-r1,
  incumbent-r2d) — real geometry, real rejection records, two optionsHash generations.

## Round 1 — RULED (kaitpw, 2026-08-16)

The question was "grid of zones, table of runs, or a plan?" — the answer is **all three, docked**:
"general idea of all is right. sheet is closest to the contact sheet I imagined, although i'd
like richer summary info; table is nice for high level 'what improved'; plan is important."

**Winner: the composite.** Sheet is the main feature (the page body); the plan docks collapsible
at the TOP (like /takeoffs atlas); the ledger docks collapsible at the BOTTOM. No variant won its
own layout; all three won their product argument — the round retired the idea that this page is
any ONE of them.

**Donations absorbed into the combo:** sheet → card/panel renderer + level sections + scrubber;
ledger → delta columns, chronological-predecessor deltas, changed-zones-only A/B materiality;
light → level canvas at native raster, fixed-frame flip-booking, synced panes, zone peek.

**Structural findings promoted to backlog:** zone identity is positional across runs (stable zone
key wants to live in report.json); TSV rooms carry no accepted/held flag (convention lives in the
python renderer); overlay-diff needs per-run room masks (stays deferred).

## Round 2 — the combo (spec from kaitpw, tentative, iterate live)

- Sheet grid = **two columns, not four** (richer cards).
- **A/B is the default state**: previous-run selector defaults to the latest previous run; each
  zone card shows A|B with stats + deltas. **Layout never shifts** — no prev run selected is
  still the same two-column footprint.
- Plan: copy /takeoffs atlas presentation (collapsible top pane, resizable). Floaters: zone
  zoom-in, the key (takeoffs' key is bad — do better), level-wise stats relevant to algo tuning.
- Ledger: collapsible bottom dock.
- **All plan underlays desaturated/partially grayed** — SVG was impossible to see over full-value
  ink. SVG color/style rebalanced against the muted underlay. Underlay togglable.
- Chrome: match the app (light mode); round-1's dark sheet/ledger chrome dies.

## Fixture silences (write-downs, not guesses)

- `scores.json` (savedWork et al.) is not yet part of the run package; board cards derive from
  report.json only. If the ledger variant needs savedWork columns, that is a persist-time gap —
  note it, don't recompute the python scorer in TS.
- TSV `POLY` ring-kind vocabulary is passed through untyped; first ring = outer is assumed.
- Level-wide bins mean zone crops share rasters; per-zone Ink paths repeat per level.
