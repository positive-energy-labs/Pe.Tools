# /runs clean room — dev-only takeoff result browser

Living doc for the find-the-product loop on the run-history surface. Dev-only tool: prod
standards do not hold, but the design system does (COLOR-ROLES tokens, canon primitives where
they fit). No surface has to catch up to this one; this one borrows freely from the atlas.

**No catch-up debt.** This surface was born on role tokens — there is no legacy palette, no
`cat-*` alias residue, no dark-chrome shim to unwind. Whatever the design system ratchets next,
/runs is already on the near side of it. Its open stand-ins are all *data* stand-ins, ledgered in
[SHIMS.md](SHIMS.md), not styling debt.

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

## Shared infrastructure

*(Round-1/2 shape, kept for the record. Post-close the files are `src/runs/world.ts` and
`src/runs/browser.tsx` — see the round-2 close section.)*

- `src/runs/proto/world.ts` — run index, report/tsv/INKP loaders + caches, model→px transform,
  raster painter with the screened-closure treatment, board summary.
- The run-pool server `pe:takeoff-runs-pool` serves `/api/runs-data/*`. It is a TanStack Start API
  route (`src/routes/api/runs-data.$.ts`), not a vite plugin — the name is a role, not a location.
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

- `scores.json` (savedWork et al.) is not part of the run package; board cards derive from
  report.json only. If the ledger needs savedWork columns, that is a persist-time gap — note it,
  don't recompute the python scorer in TS. (Now [SHIMS.md](SHIMS.md) #1.)
- TSV `POLY` ring-kind vocabulary is passed through untyped; first ring = outer is assumed.
- Level-wide bins mean zone crops share rasters; per-zone Ink paths repeat per level.

## Round 2 — CLOSED (promoted 2026-08-17)

The combo won. It is now the one /runs surface, not a variant of it.

**Promoted.** `src/runs/proto/combo.tsx` → `src/runs/browser.tsx` (the takeoff run browser);
`src/runs/proto/world.ts` → `src/runs/world.ts` (no longer a prototype fixture — the canon data
layer for the surface).

**Deleted.** `src/runs/proto/` is gone: `sheet.tsx`, `ledger.tsx`, `light.tsx`, and `switcher.tsx`.
Their product arguments were absorbed into the combo at round-1 ruling; their layouts lost. Git
history preserves them at **a26916e / 33139e2** — that is the archive, not a `proto/` directory
kept alive out of sentiment.

**The switcher is dead, and so is `?variant=`.** `src/routes/runs.tsx` mounts the browser
directly, with no search param, no lazy variant map, and no floating off-system switcher. One
capability, one path. Kept from round 2: the `import.meta.env.DEV` gate, and the light-mode pin
(kaitpw ruling — the plan and card palettes are calibrated on light ground; the profile's theme is
restored on leave). `←/→` are free again now that the switcher no longer eats them; `↑/↓` still
scrub the current run through the pool.

**Listed.** `/runs` now appears in the route directory on `/`, gated on `import.meta.env.DEV` so
the shipped build never advertises a route that 403s.

**Wired at close.**
- *Pool identity.* The pool server already reported which directory it resolved to; the client was
  discarding it. `fetchRunIndex` now returns `RunPool = { pool, runs }`, and the surface states the
  absolute pool path — a muted mono line in the ledger dock, and in the empty state where the
  question "which pool?" is loudest.
- *`adaptedKnobs`.* Settled, not deferred: it is persisted on every zone as
  `IReadOnlyDictionary<string,string>` and is empty across the entire pool because the adaptive
  seam carries no live rules. Now typed on `ZoneRecord`. Empty is a fact about the solver.
- *Empty pool.* A real empty state on the canon `EmptyState` primitive, telling the **system**
  story — no runs captured yet; the pool fills itself the next time
  `ZoneBoundedDetectTests.ProjectA_zones_partition_within_declared_scope` runs — plus the pool path.
  Not a filter story: nothing is hidden, nothing has been captured.

*(Deviation worth naming: the canon `EmptyState` lives in `src/ops/primitives.tsx`, not
`components/lang` — `components/lang` has no empty-state primitive. It is pure presentation with no
ops coupling, so /runs borrows it rather than forking a second one. If an empty state ever earns a
place in `components/lang`, both callers move together.)*

**Still open.** Everything the surface fakes or cannot say is now ledgered in
[SHIMS.md](SHIMS.md) — scores.json, stable zone identity, TSV disposition, overlay-diff masks,
Revit-export underlay, the speck filter, and the bounds-shaped viewport. Each in-code `// gap:`
comment points at its number.

## Philosophy fold-in owed at merge

Durable findings this loop produced that belong in `docs/design/SURFACE-PHILOSOPHY.md`. **Do not
edit that file from this branch** — it is being rewritten on main and a worktree edit guarantees a
conflict. Fold these in when `room-solve-tuning` merges:

1. **A page can be a composite of docked answers.** No variant won its layout; all three won their
   product argument. When a round's variants each answer a different real question, the product is
   not "pick one" — it is the body plus the docks, with the losing layouts deleted and their
   arguments absorbed.
2. **A/B against the chronological predecessor as a DEFAULT state, not a mode.** Comparison is on
   when you arrive; clearing the baseline empties the A side without shifting the layout by a
   pixel. Comparison that costs a layout reflow is comparison people stop using.
3. **The muted-evidence underlay law.** Evidence desaturates so decisions can be read — and the
   honesty semantics survive the muting: solid still means received, screened still means invented.
   Muting is a change of volume, never a change of claim.
4. **The ledger's row marks ARE the run selector.** A table of the things you can select does not
   need a separate selector above it. The marks in the row are the control.
