# Design-system cutover — open stand-ins

Ledger per SURFACE-PHILOSOPHY §3: one numbered entry per gap, naming what discharges it.
Entries leave only when the replacement ships; numbers are stable — closed entries are struck
and named, never renumbered. Context: `docs/features/design-lang/CLEANROOM.md`.

1. **Old `ui/verb`, `ui/chip`, and blue-default `ui/button` still live** beside their
   `components/lang/` successors. They stay because the in-flight family clean-room and 22
   button importers consume them. Discharged by: the per-route normalization crusade
   migrating each consumer onto `lang/`, then deleting the superseded primitives.
2. **The design-lang proto (`src/design-lang/*`, `/design-lang` route) is the validation
   record**, not yet deleted. Discharged by: the new `/design-system` index absorbing the
   spec content and a round-3 decision that no further palette/grammar rounds need the
   harness; then the proto folds to its snapshot branches.
3. **`ArmingStrip` ships with no live consumer.** The family apply verb is the intended
   first consumer (the ceremony clause no surface has built). Discharged by: family route
   normalization wiring it to a real `write:model` commit.
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

1. **MasterTable cell-state clause.** `Column.cell` is an opaque ReactNode: the table can't
   know a cell carries state, so the state column re-models the same fact by hand,
   `CellStateKey` can't derive axes from rows, selection/hover/tokens are old-vocabulary
   (two palettes visible inside one artifact frame), the table always draws its own head
   beside `ArtifactFrame`'s, `FilterChip` triplicates `NarrowChip`, and there is no
   footline/summary row for receipts. The single highest-leverage primitive change.
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
- **The trichotomy reviewer rebuilt on `StateCell`** — named as soon-consumer everywhere;
  the proposal-flow satellite currently stands in for it.
- **Verb busy+disabled composition** — a busy-and-refused verb is unrenderable.
- **`--viz-*` palette** still consumer-less; charts/taxonomy absent from the catalogue.
