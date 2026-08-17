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

## Feedback loop — round 1 (proto/runs-feedback, 2026-08-17)

The surface's next loop: handing kaitpw's visual verdicts on tuning runs BACK to the
orchestrating agent. Settled product shape (kaitpw grill, 2026-08-17):

- **Stage for export** on every zone A/B card.
- **Staged panels are annotatable**: click an accepted-room or residue polygon to FLAG it
  (alarm family). A flag is DATA — the element id (`room:R06`, `residue:R03`) goes in the
  manifest, not just pixels. Zone boundary/edges are NOT flaggable (ruled out for now).
- **One free-text note per staged item**, TASTE.md-verdict shaped. No per-flag notes.
- **Export, three verbs, all real**: (a) *copy for chat* (PRIMARY) — per-item composited PNGs
  (underlay + SVG overlay + caption strip) + manifest.json written to
  `<pool>/_exports/<stamp>/`, and a compact TEXT BLOCK (zone, A/B run ids, flagged element
  ids, note, absolute PNG path per item) on the clipboard — text-with-paths is the lingua
  franca because agent TUIs can't paste images; (b) *copy sheet PNG* — one stitched contact
  sheet on the clipboard as an image for GUI chats; (c) *save + open in Snipping Tool* —
  Windows already ships the freehand-annotation UI, deliberately not rebuilt.
- Compositing is client-side (canvas underlay + serialized SVG + caption). The server
  (`src/routes/api/runs-export.ts`, sibling of the pool route) only writes files, fills the
  manifest's absolute paths, launches Snipping Tool, and provides the OS-clipboard fallback.

**Round-1 variants** — one route, `?fb=tray|deck|ledger`, floating off-system switcher
(idiom from a26916e), all three sharing the staging store + export plumbing
(`src/runs/proto-fb/`, throwaway-marked). Structurally different answers to "where does
staging live":

- `fb=tray` — staging lives in a docked TRAY (cart pattern); flags in place on the card
  SVGs; the page stays the page.
- `fb=deck` — staging collects quietly; "review N staged" opens a full-viewport REVIEW DECK,
  one item at a time at maximum size, keyboard prev/next, export verbs at deck end. Checkout
  flow.
- `fb=ledger` — staging RIDES THE LEDGER dock: staged items as marked entries beside their
  runs, the dock grows the export verbs. No new chrome regions.

**Live-verified 2026-08-17** (real pool copy, A=baseline-fresh vs B=124019): all three verbs
ran for real from the tray; chat verb re-ran from the deck's export step and sheet verb from
the ledger strip; clipboard text block's absolute paths resolve; the contact sheet landed on
the Windows clipboard as an image (1316×1262); Snipping Tool opened the exported PNG
(window-captured to prove the file loaded, not just the app).

**Windows fact, verified by invocation**: `SnippingTool.exe <file>` IGNORES the file argument
(opens blank). `ms-screensketch:edit?filePath=<url-encoded>` opens the PNG in the editor.
The server uses the protocol.

**Build friction (round output):**

1. *ZonePanel does not expose its pixels.* Export compositing re-paints panels from
   `world.ts` primitives and duplicates browser.tsx's palette constants (the promoted file
   doesn't export them; this round wasn't allowed to restructure it). If feedback promotes,
   the panel painter (underlay + decisions at arbitrary size) wants to be world-owned, called
   by both the DOM panel and the exporter.
2. *The decision overlay is display-only by construction.* `fill="none"` SVG paths take no
   interior clicks; flaggability needed `pointerEvents="all"` + cursor + handlers threaded
   into the promoted ZonePanel. Making a read overlay interactive is a mode flip, not a prop.
3. *Zone-peek is a READ surface.* fb=ledger's brief (annotate in the existing zone-peek)
   fought the peek's `pointer-events-none`, hover-transient nature. Notes moved inline into
   the dock strip. Finding: annotation needs a pinned interactive surface; the peek is
   deliberately not one.
4. *Positional zone identity (SHIMS #2) leaks into staging.* The staged key is
   zone-name + run pair, snapshotted at stage time. Change the baseline afterwards and the
   card no longer reads "staged ✓" even though the tray holds the item — correct snapshot
   semantics, but name-keyed identity cannot say "same zone, different pair".
5. *Module-singleton store vs HMR.* The external staging store (useSyncExternalStore
   singleton) splits across vite hot-swaps — observed live as an export whose status never
   rendered. Full reload heals it; a promoted version belongs in context or a router store.
6. *navigator.clipboard demands user activation.* Any non-gesture invocation (and embedded
   panes) gets NotAllowedError. The server-side `Set-Clipboard` fallback (which also drops
   `clip.txt` beside the PNGs as the export's own record) proved the robust lane on Windows —
   candidate to become the PRIMARY clipboard, not the fallback.
7. *Rooms and residues share the R-number namespace* (zone #08 has both room R06 and residue
   R03 vocabulary; #06 has room R03 AND residue R03 lineage). The `kind:` prefix in flag ids
   is load-bearing. Adjacent to SHIMS #3 — a persisted stable element id would serve
   annotation better.
8. *Arrow-key contention.* The deck's prev/next and the switcher's variant-cycle both want
   ←/→; the deck captures while open. Throwaway-grade fix; a promoted review mode should own
   an explicit key scope.

**Practice corrections to the settled shape:** flags draw on the B panel only — a flag is a
judgment about the current run; mirroring it on A would double-report (the brief said
"staged panels are annotatable", practice narrowed it to B). The caption strip earned its
place: it makes each PNG self-describing so an agent reading images off the paths needs no
manifest in-context.

## Feedback loop — round 2 (CONVERGED, 2026-08-17)

Round 1 was RULED by kaitpw; round 2 converged the three variants into ONE product and
applied the full change list. Live-verified against the real 12-run pool.

**Rulings (kaitpw, 2026-08-17 — quoted as law):**

- "TRAY WINS. The deck and ledger variants DIE as chrome (delete their code); the deck's
  review UX survives as a MODE: a 'review staged' button on the A/B pane switches its layout
  to single-column (bigger images), filtered to staged items only. A/B card mechanics stay
  byte-identical between normal and review views — one card component, two layouts."
- "The ?fb= variant param and the dark switcher pill DIE. One product now."
- "Tray becomes a COLLAPSIBLE RIGHT SIDE PANE of the A/B section (not page-height chrome)."
- Change list, kaitpw's words: (1) instant room-id popover — "the native info onhover
  displays too slowly to be useful … it must always show when the cursor is a reticle";
  (2) underlay — "the dithering or whatever on the plan image is confusing. try another
  approach like simple opacity"; (3) plan "focus" verb → "highlight" TOGGLE; (4) sheet↔plan
  scroll-sync, bidirectional; (5) plan floaters hideable like the /takeoffs atlas treatment;
  (6) hover zone summary centered ON the A/B split line, A values on the A side, B values on
  the B side.

**State model (settled after grilling — the round's core decision):**

- **Lens vs pin.** A staged item PINS (zone, runA, runB, flags, note) at stage time. The page
  A/B selector is a viewing LENS only — switching it never alters the stage. Staged cards show
  their pinned pair plus a subtle `≠ lens` mark when pin ≠ lens; clicking a staged tray row /
  review header (or a card's `⚑n≠` mark) swings the lens to the pinned pair. Multi-run stage
  sets are normal.
- **Persistence is the EXPORT MANIFEST, nothing else.** The parallel-truth rationale: any
  second persisted staging store (localStorage, URL-encoded staged sets, a server-side
  session) would be a competing writable truth that can drift from what was actually
  exported. The manifest already had to exist for the agent lane; making it the ONLY
  persistence means "what you can reload" and "what you shipped" are the same file.
  `?set=<stamp>` rehydrates staging (editable) from `_exports/<stamp>/manifest.json` through
  the pool file server; re-export mints a NEW stamp (the export server suffixes collisions —
  an export can never overwrite an earlier set). The manifest documents its own schema in a
  `schemaNote` field (v2: adds stamp, setUrl, stagedAt, and the pinned pairs).
- **`?a=&b=&zone=` is a stateless deep link**: sets the lens, highlights + scrolls to the
  zone, stages NOTHING. No raw multi-pair URL encoding exists anywhere, by ruling.
- **The OS clipboard is the PRIMARY copy path** (`Set-Clipboard` / `SetImage` server-side,
  in the same POST as the write); `navigator.clipboard` is the fallback — the reverse of
  round 1, promoted because the browser lane demands user activation and fails in embedded
  panes (round-1 friction #6). `clip.txt` is ALWAYS written, every verb, and the clip block
  carries the set's own `?set=` URL.

**What died (history holds them at 34ce188):** `src/runs/proto-fb/` entirely — `deck.tsx`,
`ledger-strip.tsx`, `switcher.tsx`, `mount.tsx`, and the `?fb=` gating. What survived moved to
`src/runs/feedback/` (staging store, export verbs, compositor, tray, hydrate) — promoted, not
throwaway-marked. The store now parks its singleton on `globalThis` (round-1 friction #5: HMR
split the module singleton).

**What changed per ruling item (all live-verified):**

1. *Instant popover*: rooms/residues on every A/B panel carry a zero-delay cursor-following
   id popover (element id only; alarm-toned + ⚑ when flagged); the native `<title>` on those
   paths is gone. Hover works on both panels; click-to-flag still arms only on a staged B.
2. *Underlay*: the checkerboard screening DIED. Invented closures paint continuous but
   translucent + warm-tinted (`palette.ts` SEAL_M/CLOSE_M alpha ~110/235); received ink stays
   the near-opaque neutral. The round-1 "underlay law" comment in `world.ts#paintRaster` now
   documents the revision: the honesty claim (solid = received, distinct = invented) survives
   as opacity+hue instead of screening, and the key says so out loud ("solid dark = received ·
   pale translucent = invented"). Palette moved to `src/runs/palette.ts`, shared with the
   export compositor (round-1 friction #1 resolved — screen and PNG cannot drift).
3. *Highlight toggle*: page-owned `highlight` state shared by plan and cards. Card button
   activates + centers the plan; re-click (either surface) clears; another zone replaces;
   esc clears. Plan polygon clicks light the card's button and vice versa.
4. *Scroll-sync*: the level section in view drives the plan's level tab (scroll listener on
   the sheet); a tab click smooth-scrolls the sheet to the section. A `suppressUntil` window
   keeps the programmatic scroll from echoing back mid-flight; no fighting observed.
5. *Floaters*: key + level-stats floaters get `×` closes and `key`/`stats` header toggles
   (the atlas statsOpen idiom).
6. *Zone peek*: centered on the A/B split line (bottom-center of the dock), zone name
   centered on top, labels centered in the middle column, A values right-aligned toward the
   A pane, B values left-aligned toward the B pane.

**Verified live (2026-08-17, real pool, 12 runs incl. wave-1 experiment packages):** staged
across two different A/B pairs (161753→161910 with a flagged residue + note; 160627→160730),
lens swings both ways off the tray rows with `≠ lens` marks tracking; review-staged mode
renders both items single-column at pinned pairs; chat export wrote PNGs + manifest v2 +
clip.txt and put the block on the OS clipboard; sheet export minted a NEW stamp and landed
1316×1244 on the clipboard as an image; `?set=20260817-133100` rehydrated the full set
(flags, note, pinned pairs, staged marks) in a fresh tab; `?a=&b=&zone=Main Level#05` set the
lens, highlighted + scrolled to the card, staged nothing. `tsc --noEmit` clean. The snip lane
was not re-run this round (unchanged protocol launch, verified in round 1).

**Residual debt:** the export compositor still re-implements ZonePanel's layer order instead
of a world-owned panel painter (round-1 friction #1, second half). Zone identity in staging
and manifests is still the positional name (SHIMS #2) — a rehydrated set silently re-binds by
name if zoning changed. Console shows 404/500s for zones whose packages carry no rasters
(pre-existing; panels fall back to decisions-only by design).

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
