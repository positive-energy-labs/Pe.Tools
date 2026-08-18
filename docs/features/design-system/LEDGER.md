# design-system ledger

## Decided

- 2026-08-16 — the design-guard test IS the lint: the web app has no CI, so token discipline holds by assertion in `vp test` (the `ready` lane), not by review. Five hard zeros + five ratchets against `design-guard.baseline.json`; baselines may only fall, and a count *below* baseline also fails so the ratchet cannot silently slacken. Full rationale lives in the test header (`apps/web/src/design-guard.test.ts`).
- 2026-08-16 — the ground flip: the `--st-*`/`--act-*`/`--cat-*`/legacy-palette alias shim in `styles.css` reads zero lines and never grows one back. Consuming the old vocabulary is consuming nothing, so it is a hard zero rather than a deprecation.
- 2026-08-16 — the `/design-lang` proto route and `src/design-lang/*` were deleted once they had served as the validation record; the losing rivals survive only on snapshot branch `proto/design-lang-base2-round2`, and palette values are single-homed in `src/design-lang.css`.
- 2026-08-16 — satellite demos are deliberately mocked (fixture data, null identities, no host calls) and say so. This is not a gap to discharge: satellites exist to show complicated cases a real route cannot reach.
- 2026-08-16 — shadcn exhibits with zero product consumers are evicted from the index rather than catalogued: the index documents components with a proven consumer, so an un-consumed component is either given one (and re-admitted with the consumer named) or deleted.
- 2026-08-16 — the per-route crusade runs BEFORE satellite work, deliberately: catalogue entries must be backed by real consumers, so satellites are explicitly not blockers.
- 2026-08-16 — `stateColumn` replaced by the typed `verdict:` column clause, not by the proposed `state:` + `word` path. Overruled by families #1's evidence: a pipeline verdict is a second legitimate column form, not a pseudo-dimension of a value column.
- 2026-08-16 — `ArmingStrip`'s lifecycle is validated against a real gate: `/parameter-links`' preview→stale→apply maps onto it (no fresh preview → `refused` with re-plan; preview verified → `arming`, reason input arms the one commit).
- 2026-08-16 — ADR 0003 collapsed the glance client fan-outs into first-class host packets: `revit.glance.model` (was 4 calls, 3 truncation dialects) and `revit.glance.attention` (was 3 calls; limits are host-owned and never clamp to the minimum).

## Tried & rejected

- 2026-08-16 — `state:` + `word` column clause for MasterTable cell state: overruled by the families verdict-column evidence (see Decided); the parallel `stateColumn` renderer was deleted rather than migrated.
- 2026-08-16 — oxlint as the token-discipline enforcement lever: waived in favour of one dependency-free directory walk with plain regexes inside the existing test lane; oxlint stays an optional later hardening.

## Owed

- Delete `components/ui/button`: still ~13 importers (down from 22). Each route pass migrates a consumer onto `lang/Verb` and lowers the `uiButtonImports` ratchet; the file dies at zero.
- One popover foundation in `components/lang/` that every popover-bearing component sits on. Measured evidence (5 specimens): combobox's hard `w-(--anchor-width)` wins every merge so caller widths are silently ignored, `ui/select` states the opposite law, `align="end"` is hard-coded, and the private duplicates `ColFilter`/`Picker` cannot be imported by anyone else. (Mechanism note lives at `components/ui/combobox.tsx`.)
- Per-route normalization crusade — route by route, replace hand-rolled state rendering with `lang/` primitives, migrate `ui/*` consumers, evict or admit the shadcn remainder. Gated on user alignment on the new design-system route set.
- Section/page-chrome primitive: every new route hand-rolled the same Section/SectionHead chrome (three near-identical copies exist) — the most visible thing `lang/` is missing.
- The addressing-sentence component: `NarrowChip` owns removal but nothing owns re-adding, and the "is the sentence an artifact?" border-budget edge case is unshowable until it exists.
- MasterTable remainder from the cell-state clause: `CellStateKey` deriving axes from on-screen rows, row-level proposal marking beyond `rowClassName`, the double head beside `ArtifactFrame`, `FilterChip` vs `NarrowChip`, no receipt/footline row.
- The trichotomy reviewer rebuilt on `StateCell` — named as soon-consumer everywhere; the proposal-flow satellite stands in for it today.
- Verb busy+disabled composition: a busy-and-refused verb is currently unrenderable.
- A catalogued chart/series consumer for `--viz-1..6` (tokens shipped 2026-08-16, band-quantized, grayscale law); ops `CoverageBar` is the designated first, arriving with the ops migration.
- State-model gaps that limit component honesty — staged author, severed proposals, arming-lifecycle timestamps, outcome→verb linkage. Components take only ruled props; discharged by the corresponding `@pe/agent-contracts` / route-state changes, then widening the props.
- Op-contract asks left over from the glance prototypes (2026-08-16, ahead of the ops migration): `revit.catalog.sheets` — flat sheet list with series grouping plus per-sheet anchor thumbnails in one bounded call (today `/glance` takes `revit.catalog.project-index` Sheets + a staged 10-sheet `revit.detail.sheets` batch); and `host.topology` carrying per-session documents plus the host's own port/baseUrl (today a staged 1+N client fan-out, bounded at 12).
