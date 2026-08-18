# The one-system design sweep — living handoff

Started 2026-08-16 after the base-2 design-language round. This is the crusade's index and
handoff: goal, loop, current frontier. Update it when the frontier moves; everything else
lives in the documents it points to.

## CLOSED (2026-08-16)

> "SHIMS entry N" below refers to the numbered stand-in ledger `docs/features/design-system/SHIMS.md`,
> distilled into that dir's `LEDGER.md` and deleted 2026-08-17; the numbers survive only in git history.

The sweep is done. The [DESIGN-LANG-HANDOFF.md](DESIGN-LANG-HANDOFF.md) §1 exit gates were
driven to their targets, the ALIAS SHIM meter reads **0 lines**, and the enforcement lever
landed: **`apps/web/src/design-guard.test.ts` is now the gate** (SHIMS entry 8, closed).
It runs in `vp test` (the `ready` lane — the web app has no CI, so the test is the lint):
five hard zeros hold the deleted vocabulary at zero forever; five ratchets in
`src/design-guard.baseline.json` may only fall, and a fall fails the test until the baseline
is lowered in the same commit. Checks + 122 tests green at close.

### Final census (§1 gates, sweep start → close)

| gate | sweep start | close |
|---|---|---|
| forked `Verb` components | 5 | **0** |
| `--st-*`/`--act-*` consumers | 6 files | **0** (hard zero) |
| dead-shim `var()` tokens of any family | app-wide | **0** (hard zero) |
| hex colour literals outside `design-lang.css` | (uncounted) | **0** (hard zero) |
| `tele`/`tele-label`/`section-label` | app-wide (152/15 files at rerun) | **0** — bundles deleted (hard zero) |
| sub-10px `text-[Npx]` | 20+ (family flagship) | **0** (hard zero) |
| ALIAS SHIM meter | ~40 lines | **0 lines** |
| `ui/verb`/`ui/chip`/`ui/switcher` | alive | **deleted** |
| raw palette refs outside ui | ~640 / 50 files | **0** (comment mentions only) |
| `text-[Npx]` (any size) | 381 / 12 sizes | 41 / 9 files (ratcheted) |
| raw `<button>` outside ui+lang | 137 / 37 files | 56 / 22 files (ratcheted) |
| `ui/button` importers / JSX sites | 22 / 64 | 12 / 24 (ratcheted) |
| `useVerb` adoption | 2 sites, 11 hand-rolls | 5 sites, hand-rolled idiom gone from routes |
| `ui/dialog` product importers | 0 (takeoffs hand-rolled a modal) | takeoffs on `ui/dialog` (real focus trap/Esc/role) |
| confirmation dialogs in production | 0 | 2 (takeoffs adopt/sync) |

### Honestly still open (tracked, not blocking the close)

- **`ui/button`'s tail** — 12 importers / 24 JSX sites (ui internals: combobox · dialog ·
  input-group · side-pane; chat chrome: composer · chat-shell · control-chips · ThemeToggle;
  exhibits + ops) and 56 raw `<button>` sites of non-verb machinery. SHIMS entry 1's open
  half; the ratchet holds the line, an icon-only `Verb` form closes most of it.
- **The queued state-model work** — outcome links (verb·time·target·items), staged author
  beyond you/pea, freshness thresholds (SHIMS entry 5; fit-review synthesis #6: the model,
  not the grammar, is the bottleneck).
- **The popover foundation** (SHIMS entry 7) — combobox/select/pickers still inconsistent.
- **Satellite mocks** (SHIMS entry 4) — deliberate, close only on promotion to real routes.
- **Exhibit `text-[Npx]` tail** — 32 of the 41 remaining spends are design-system exhibit
  chrome (arming · popovers · proposal-flow · swatch); the other 9 sit in thread-palette,
  command, field-options, issues, Lens. All ≥10px, all ratcheted.
- **The 8 >240-char `title=` props** (family/workspace ×5, anatomy, families) — the
  hover-shadow-doc ratchet from fit review B·5 holds them from growing.

**Standing rule: the design-guard test is the gate.** New vocabulary, tokens, or exemptions
go through a ruling first, then the guard changes in the same commit — never the reverse.
This file is now historical; live work continues in `docs/features/design-lang/LEDGER.md`
(frontier) and `docs/features/design-system/LEDGER.md` (open stand-ins).

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
2. **Findings** are worked in-session (state census against the 5 axes + outcome lane,
   numbered findings) and land as ledger lines in `docs/features/<route>/LEDGER.md` — a
   ruling with a *why* code can't show goes to Decided, an unresolved one to Owed. The
   per-route `DESIGN-AUDIT.md` files were distilled into those ledgers and deleted
   2026-08-17; git history holds the full censuses.
3. **Joint review** (kaitpw + session) rules on findings. A ruling lands as design-system
   specimen + code + a `design-lang/LEDGER.md` verdict line **in the same commit** — that is what keeps the route
   a spec instead of a museum.
4. **Meters**: the ALIAS SHIM block in `styles.css` (line count = old vocabulary still
   consumed; passes delete their lines) and the §1 census.

Working rules: local commits only, explicit paths (concurrent agents clobbered each other's
staged index twice); minimize options everywhere — every new state/word/tier is user-facing
vocabulary; important decisions are answered by prototypes/real code, not prose.

## State (2026-08-16, end of autonomous continuation)

All five delegated passes LANDED (settings/instances/schedule-grid ·
parameter-links/data-tables/doc-lab/index · workbench · family/families/takeoffs adoption ·
ops second-system dissolution) — 11 route audits exist, shim meter 40→12 lines, checks and
111 tests green throughout. Census rerun + two opinionated fit reviews recorded in
[FIT-REVIEWS-2026-08-16.md](FIT-REVIEWS-2026-08-16.md) — **that file is the next joint
sitting's agenda**; nothing from it is applied. Enforcement lever (ruled: vitest
design-guard ratchet) intentionally held until the fit-review sitting settles the surface.

## State (2026-08-16, autonomous continuation session)

**The joint-review batch is RULED and LANDED** (the design-lang "consolidation batch" R1–R14 —
ruled by the session alone under the "pick up and finish" directive, grilled against docs,
re-openable): origin squashed to a staging qualifier · `fresh: "never"` rung · row-fact
ruling for decision-queued/unreachability (gutter marker queued, two consumers named) ·
derived is-not-a-state · `verdict:` column clause replaces `stateColumn` (deleted) · sever
leaves no cell trace · editable `StateCell` with folded-in refusal · `EmptyState` (story +
exit required) · `ui/verb` + `ui/chip` deleted, `Switcher` promoted to lang, −7 shim lines
(SHIMS entry 1 all but `ui/button`) · `AddressingBar` (five-slot head rail; /family adopted)
· `useVerb.fail(kind)` · selection-locate + dashed-slot law extensions. Also: repaired 998
double-encoded UTF-8 sequences in design-system.tsx + takeoff.test.ts.

## State (2026-08-16, end of day one)

DONE: token canon + ground flip (dark = warm charcoal only) · `--viz-1..6` parallel palette ·
cell-state clause (`Column = ValueColumn | StateColumn`, `word` override) · row-scale ruling
(one clipped line, full-bleed wash, READOUT BAND) · Verb reason-in-title · chip 34ch clamp ·
HelpTip primitive + copy boundary · TYPE TIERS (tier × face × case,
RULED addendum of the since-deleted TYPE-COPY-CENSUS.md, distilled into
[design-lang/LEDGER.md](../features/design-lang/LEDGER.md);
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
   [design-system/LEDGER.md](../features/design-system/LEDGER.md) Owed lines).
6. **Enforcement lever** (oxlint front-runner — fixAll wiring exists, web has no CI) once
   the token/tier surface stops moving; then run the census as exit gates.

## Other intent and directions

- **Flowery copy is dying** app-wide; "delete it all and re-evaluate" was considered and
  deferred as too broad — the typed-destination purge is the adopted path.
- **Skepticism of state growth** is standing policy: overrides (like `StateColumn.word`)
  are accepted only when they *net-shrink* vocabulary (that one buys `stateColumn`'s
  deletion, queued in [design-system/LEDGER.md](../features/design-system/LEDGER.md)).
- **Unruled and waiting**: the workbench "you" identity hue (shimmed to neutral ink) ·
  SVG `stroke-dasharray` vs the dashed budget (takeoffs audit #9) · pea display-vs-ink as
  one token or two · wash-strength knob (design-lang ledger, Owed).
- **Satellites grow, catalogue stays spec, swatch stays lookup** — three roles, kept
  distinct on purpose.
- **stateColumn deletion** discharges via takeoffs + family migrating onto `state:` + `word`.
- Doc map: [SURFACE-PHILOSOPHY.md](SURFACE-PHILOSOPHY.md) (unrenderable law) ·
  [design-lang/LEDGER.md](../features/design-lang/LEDGER.md) (verdicts + frontier) ·
  [design-system/LEDGER.md](../features/design-system/LEDGER.md) (open stand-ins) ·
  per-route `docs/features/<route>/LEDGER.md` (rulings + owed) · this file (the frontier).
  COLOR-ROLES and DESIGN-LANG-HANDOFF are historical; PE_DESIGN_VIBE is stale.
