# The one-system design sweep — living handoff

Started 2026-08-16 after the base-2 design-language round. This is the crusade's index and
handoff: goal, loop, current frontier. Update it when the frontier moves; everything else
lives in the documents it points to.

## Goal

**One design system rules every surface, and the code is the spec.** `components/lang` +
the `--r-*` canon (`apps/web/src/design-lang.css`) win everywhere — ops included, no
exemptions. The `/design-system` route is the executable authority (INDEX LAW: nothing
appears without a real or soon-real consumer); prose survives only where it cannot render
([SURFACE-PHILOSOPHY.md](SURFACE-PHILOSOPHY.md), ratcheted).

**Done** means the [DESIGN-LANG-HANDOFF.md](DESIGN-LANG-HANDOFF.md) §1 census numbers reach
zero: no forks, no raw palette outside canon, no hand-rolled state rendering, one vocabulary.
Executed only after total alignment — the census gates become the lint rules.

## The loop

1. **Per-route pass** (delegated): best-effort upgrade onto lang components + real `--r-*`
   roles. A pass may NEVER change the language unilaterally — where the language can't
   express something, the code stays honest and the gap is filed.
2. **Findings** land in `docs/features/<route>/DESIGN-AUDIT.md` (state census against the
   5 axes + outcome lane, numbered findings). Takeoffs and families audits are the format.
3. **Joint review** (kaitpw + session) rules on findings. A ruling lands as design-system
   specimen + code + CLEANROOM verdict **in the same commit** — that is what keeps the route
   a spec instead of a museum.
4. **Meters**: the ALIAS SHIM block in `styles.css` (line count = old vocabulary still
   consumed; passes delete their lines) and the §1 census.

Working rules: local commits only, explicit paths (concurrent agents clobbered each other's
staged index twice); minimize options everywhere — every new state/word/tier is user-facing
vocabulary; important decisions are answered by prototypes/real code, not prose.

## State (2026-08-16, end of day one)

DONE: token canon + ground flip (dark = warm charcoal only) · `--viz-1..6` parallel palette ·
cell-state clause (`Column = ValueColumn | StateColumn`, `word` override) · row-scale ruling
(one clipped line, full-bleed wash, READOUT BAND) · Verb reason-in-title · chip 34ch clamp ·
HelpTip primitive + copy boundary · TYPE TIERS (tier × face × case,
[TYPE-COPY-CENSUS.md](../features/design-lang/TYPE-COPY-CENSUS.md) RULED addendum;
`/design-system` converted as pilot) · `/design-system/swatch` lookup satellite · takeoffs
pass · families pass · variant-e promoted to `/family` (head = one rail) · philosophy ratchet
(15 laws live) · reachability fixed.

## Next steps

1. **Joint-review batch** (rule these together, they interlock):
   - the **state-vocabulary consolidation pass** — squash axis responsibilities; then rule
     the open axis asks in one sitting: not-started rung, decision-queued (human call
     pending), DERIVED role, `severed`, unreachability, ambiguity 0/1/N (≥2-route bar).
   - **editable StateCell** — `/family` is 100% editable cells and independently reinvented
     the grammar's marks (families audit #6, the strongest finding of the sweep).
   - **EmptyState primitive** (~20 call sites waiting; philosophy law already owed).
   - fate of `ui/chip`/`ui/switcher` + the 7 remaining shim lines (alive only through the
     swatch's superseded-specimen exhibits).
2. **Component-tier pass**: lang.css + master-table chrome onto the type tiers (the spec
   page is tier-pure; its imported components aren't yet).
3. **Copy purge**, folded into each remaining route pass — mechanical now: the boundary test
   (does the sentence survive deleting its target?) routes every string to HelpTip / title /
   empty state. `/design-system` holds the only inline-prose exemption.
4. **Long-tail route passes**: settings, schedule-grid, instances, parameter-links,
   data-tables, doc-lab, index, workbench (Lens + chat + plugin shells).
5. **Ops pass, last** — needs new primitives ruled first: Provenance/MonoNote (composed-read
   honesty), OpSection, TreeView/KVGrid dispositions, CoverageBar onto `--viz-*`
   (glance contract notes preserved in
   [OP-CONTRACT-FEEDBACK.md](../features/design-system/OP-CONTRACT-FEEDBACK.md)).
6. **Enforcement lever** (oxlint front-runner — fixAll wiring exists, web has no CI) once
   the token/tier surface stops moving; then run the census as exit gates.

## Other intent and directions

- **Flowery copy is dying** app-wide; "delete it all and re-evaluate" was considered and
  deferred as too broad — the typed-destination purge is the adopted path.
- **Skepticism of state growth** is standing policy: overrides (like `StateColumn.word`)
  are accepted only when they *net-shrink* vocabulary (that one buys `stateColumn`'s
  deletion, queued in [SHIMS.md](../features/design-system/SHIMS.md)).
- **Unruled and waiting**: the workbench "you" identity hue (shimmed to neutral ink) ·
  SVG `stroke-dasharray` vs the dashed budget (takeoffs audit #9) · pea display-vs-ink as
  one token or two · wash-strength knob (CLEANROOM frontier).
- **Satellites grow, catalogue stays spec, swatch stays lookup** — three roles, kept
  distinct on purpose.
- **stateColumn deletion** discharges via takeoffs + family migrating onto `state:` + `word`.
- Doc map: [SURFACE-PHILOSOPHY.md](SURFACE-PHILOSOPHY.md) (unrenderable law) ·
  [CLEANROOM.md](../features/design-lang/CLEANROOM.md) (verdict ledger + frontier) ·
  [SHIMS.md](../features/design-system/SHIMS.md) (stand-in ledger, stable numbers) ·
  per-route `DESIGN-AUDIT.md` (findings + rulings) · this file (the frontier).
  COLOR-ROLES and DESIGN-LANG-HANDOFF are historical; PE_DESIGN_VIBE is stale.
