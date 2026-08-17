# Design-system cutover — open stand-ins

Ledger per SURFACE-PHILOSOPHY §3: one numbered entry per gap, naming what discharges it.
Entries leave only when the replacement ships; numbers are stable — closed entries are struck
and named, never renumbered. Context: `docs/features/design-lang/CLEANROOM.md`.

1. **~~Old `ui/verb`, `ui/chip`~~ and blue-default `ui/button` still live** beside their
   `components/lang/` successors. **PARTIALLY CLOSED 2026-08-16 (R10):** `ui/verb` and
   `ui/chip` deleted at zero importers; `Switcher` promoted to `components/lang` on real
   `--r-*` tokens; the seven `--act-*`/`--st-*` shim lines deleted with them. STILL OPEN:
   `ui/button` (22 importers) — discharged by the route passes migrating each consumer onto
   `lang/Verb`, then deleting the file.
2. ~~**The design-lang proto (`src/design-lang/*`, `/design-lang` route) is the validation
   record**, not yet deleted.~~ **CLOSED 2026-08-16** — proto and route deleted; rivals live
   on snapshot branch `proto/design-lang-base2-round2`; palette values single-homed in
   `src/design-lang.css`; verdicts stay in CLEANROOM.md.
3. ~~**`ArmingStrip` ships with no live consumer.**~~ **CLOSED 2026-08-16 (fit reviews,
   wave 2)** — `/parameter-links` is the first shipping consumer: its preview→stale→apply
   gate maps onto the strip's own lifecycle (no fresh preview → `refused` with re-plan =
   preview; preview verified → `arming`, the reason input arms the one commit = apply).
   The family apply verb remains the intended second consumer.
4. **Satellite demos mock their worlds.** They render fixture data by construction (null
   identities, no host calls) and announce it. Discharged by: never — satellites are
   deliberately mocked complicated cases; entries close only if a satellite is promoted to
   a real route.
5. **State-model gaps limit component honesty** (staged author, severed proposals, arming
   lifecycle timestamps, outcome→verb linkage). Components take only ruled props; the
   missing facts are frontier items in CLEANROOM. Discharged by: the corresponding contract
   changes in `@pe/agent-contracts` / route state, then widening the component props.
6. **Old shadcn exhibits with zero product consumers** (dialog, combobox, command, card
   variants…) are evicted from the index rather than catalogued. Discharged by: the
   per-route crusade either giving each a real consumer (re-admitted with it named) or
   deleting the component.

7. **No shared popover foundation exists.** Combobox, targeting dropdown, and search boxes
   are inconsistent in style and popover behaviour (flip/clamp/overflow) everywhere. The
   `/design-system` position harness makes the inconsistency visible per component.
   Discharged by: one popover foundation in `components/lang/` that every popover-bearing
   component sits on, adopted during the crusade.

8. **No enforcement lever guards the token discipline.** Nothing stops a `lang/` file (or
   any migrated route) from taking a raw colour; the contract holds by review only.
   Discharged by: the chosen lever (oxlint JS-plugin rule vs staged hook vs CI check) landing
   with the crusade — candidates already scoped in `DESIGN-LANG-HANDOFF.md` §6.

## Queued (not started — gated on route-set alignment)

- **Per-route normalization crusade**: route by route, replace hand-rolled state rendering
  with `lang/` primitives, migrate `ui/*` consumers, evict or admit the shadcn remainder.
  Gate: user alignment on the new design-system route set. Satellites are explicitly NOT
  blockers — the crusade runs first so the index catalogues components with proven
  consumers.

### Crusade roster candidates (gaps the cutover surfaced, in signal order)

1. ~~**MasterTable cell-state clause.**~~ **PARTIALLY CLOSED 2026-08-16** — `Column` is now
   `ValueColumn | StateColumn`: a `state` column declares `StateCellProps`, the table renders
   `StateCell` itself and defaults facet to `cellStateLabel` and sort to `CELL_STATE_ORDER`
   (attention order). Selection/focus are `--r-select` + `--r-line-2`, hover is the veil, and
   the table chrome is on `--r-*` natively. `/design-system` §04 is consumer #1; the takeoffs
   pass is consumer #2 (the API evidence). STILL OPEN from the original item: `CellStateKey`
   deriving axes from on-screen rows, row-level proposal marking beyond `rowClassName`, the
   double head beside `ArtifactFrame`, `FilterChip` vs `NarrowChip`, no receipt/footline row.
- **Popover foundation + one Dropdown/Picker** (extends entry 7): five specimens measured —
  three of four combobox consumers ask for a wider popup and are silently ignored
  (`w-(--anchor-width)` wins every merge) while `ui/select` grows to content (the opposite
  law); `align="end"` hard-coded; private duplicates (`ColFilter`, `Picker`) can't be
  imported by anyone else.
- **Section/page-chrome primitive.** Every new route hand-rolled the same
  Section/SectionHead chrome — three near-identical copies already exist; the most visible
  thing `lang/` is missing.
- **The addressing sentence component.** `NarrowChip` owns removal but nothing owns
  re-adding; the "is the sentence an artifact?" border-budget edge case is unshowable until
  it exists.
- ~~**Delete `stateColumn`**~~ **CLOSED 2026-08-16 (R5)** — replaced by the typed `verdict:`
  column clause (narrow meaning-role tone union); takeoffs' room-state, families' plan
  verdict and family's agreement columns migrated in the same commit; the parallel renderer
  is deleted. (The `state:` + `word` path was overruled by families #1's evidence: a pipeline
  verdict is a second legitimate form, not a value pseudo-dimension.)
- ~~**The gutter marker** (ruled 2026-08-16 R3, not yet built)~~ **CLOSED 2026-08-16 (fit
  reviews, wave 2)** — the `gutter` prop landed on MasterTable and the proven consumers
  migrated: takeoffs' flags (count of open calls, alarm; the flags column trimmed to its
  filterable words), `/family`'s ghost rows (count 1, caution, the bind crossing named),
  schedule-grid's flagged cells per row; `/settings` hand-carries the same mark on its
  non-table field grid.
- **The trichotomy reviewer rebuilt on `StateCell`** — named as soon-consumer everywhere;
  the proposal-flow satellite currently stands in for it.
- **Verb busy+disabled composition** — a busy-and-refused verb is unrenderable.
- ~~**`--viz-*` palette** still consumer-less.~~ **TOKENS SHIPPED 2026-08-16** (`--viz-1..6`
  in design-lang.css, band-quantized, grayscale law; `--cat-*` aliases onto it in the
  styles.css shim). Still owed: a catalogued chart/series consumer (ops `CoverageBar` is the
  designated first, arriving with the ops migration).
