# /family clean room — design tree (living doc)

Grill-driven redesign of /family, 2026-08-16. Prototype variants live behind
`/family?variant=a|b|c|d` (`apps/web/src/family/proto/`, throwaway). This doc records SETTLED
decisions and the open frontier; it is the memory of the grilling sessions.

## Settled

**The product reframe.** A family exists as two substrates: the PROFILE (portable, text,
pea-editable, spec-grounded) and the LIVE family (in Revit). Verbs are crossings between them.
There is no pipeline — entries are peers (edit .rfa ±capture ~40%; make/edit profile ±apply
~60%). Goal: seamless one-family management; profiles as portable units moved or materialized
at will.

**Profiles are declarative.** Direction of travel: "normalize this family to this spec" — the
profile declares the END STATE, never the operations. Partiality is legal. (Schema convergence
between the family-model json and the FF desired-state profile is an OPEN decision pending a
schema census.)

**Portability = text.** The portable artifact is the file (cf. OneDrive settings library).
.rfa files are not portable (Revit-year dependence, size). Materializing into Revit matters
but is the crossing, not the unit.

**Scope.** /family is strictly one family. Fleet/bulk is /families' responsibility (its own
UX revisit pending).

**Pea's boundary.** Pea edits the profile and links it to OCR'd text — nothing more. Humans
own every crossing. Proposals are EPHEMERAL, page-scoped UI state; never persisted (identity
drift makes local persistence not worth it).

**Evidence/build.** Omitted from the clean room for now. Push-to-Revit (materialize) will be
enabled in the UI eventually but must never be presented casually. Provenance/freshness stamps
stay ubiquitous.

**Judging bar.** First-order: a newcomer answers "what am I looking at, what state, what would
each verb do, why is that one disabled" in seconds, without tooltips (tooltips deepen, never
rescue). Second-order tiebreak: speed through the 60% story.

**Keepers.** Sentence, MasterTable, Pane primitives — extend, don't replace. No linear-steps
UI: the round-1 journey bar (variant b) actively confused; sunset the stages idea.

## Round-1 mock verdicts (2026-08-16)

- **Master cross-type table is THE interface** — a spreadsheet like /takeoffs with properly
  disabled cells; it is also the main medium for conveying state. Cross-type audit/edit is the
  differentiator from Revit itself.
- **A (Crossing)**: keep as a per-type reconcile MODE beside the cross-type table — minimal eye
  movement, stable layout, per-type capture/apply excellent. Loses cross-type view, so it
  cannot be the primary.
- **B (Stagecraft)**: sunset. Only survivor: a centralized apply list, possibly living in the
  doc pane.
- **C (Ledger)**: header-owned column verbs are clear (especially on the authored column); the
  tight Revit column is right; table metadata should become a sidebar like /takeoffs. Header
  formatting funky; loses cross-type view.
- **D (Dossier)**: proposal citations in margins are the best proposal UI seen — adapt them
  (worry: many proposals). Left-margin drift notes illegible; sectioned tables confusing.
- **Doc/spec pane**: sidebar, non-negotiable (horizontal unreadable). Two modes of ONE pane:
  OCR'd markdown AND the actual document with zoom+highlight (existing grounded-doc tech).
- **Cell approve/reject**: inline buttons shift content — needs a non-shifting affordance
  (hover absolute top-right? open question for round 2 micro-variants).
- **Anatomy SVG must return** — extraordinarily helpful when authoring solids; without it you
  construct geometry in your head or push to Revit to see.

## State-model gaps (all four builders converged on these independently)

1. No grounding link table — param↔spec-block links exist only inside proposals; accepting
   destroys the citation; grounded-but-unproposed is unrepresentable.
2. No canonical drift/agreement primitive. Needed vocabulary: agree · drift · only-profile ·
   only-live · unread (Revit not asked) · derived (formula) · confirmed (pea agrees).
3. No evidence receipt shape (age, artifact path, per-type failures); capture skips the
   versionToken law.
4. No family-level/identity drift (category, template, placement).
5. No dirty/unsaved fact on the profile document.

## E2E census verdict (2026-08-16, details in session)

Authoring half of story 2 is test-ready (settings plane guarded, save honest). Live lane is
wired but SHIMS-flagged unproven, with known defects: `family.editor.open` is ProjectOnly while
the live lane requires FamilyOnly (second pick refuses); capture stamps
`documentVersionToken: null` (can never show stale); commit-level failures return out-of-range
indexes (phantom "edit N"); rebuild to same path Conflicts (no overwrite);
validate tooltip claims SAVED but handler splices staged; `family.editor.apply` has no
concurrency guard; `supportedActiveDocumentKind` metadata is not generically enforced.
**Materialize-profile-onto-family has no one-family op path** — `familyfoundry.apply`
(planHash, receipts) is the existing materialize machinery and the strongest argument for
schema convergence.

## Schema census (2026-08-16)

Four profile types are alive, three feeding one compiler: `FamilyModel` (family.json —
declarative end-state, one family, total, identity-carrying, geometry DSL with frames +
`param:/face:` refs), `DesiredFamilyMigrationProfile` (declarative-ish, N families via
`FilterFamilies` selector, partial-by-listing, param-major per-type table, OLD geometry
language, plus four imperative op toggles), and the older `FFManagerProfile` /
`FFMigratorProfile` (near-duplicates, still registered on live commands).

Hard findings:
- **The round trip is broken by construction**: `familyfoundry.project` emits
  `FFManagerProfile`; `familyfoundry.plan` strictly rejects that shape. Project→plan→apply
  never worked end-to-end.
- **The real library is already dead at HEAD**: all 51 on-disk FF profiles are in an
  operation-named shape current code no longer deserializes; the desired-state profile has
  ZERO real authored instances; the family-model library is 2 toy files. Convergence breaks
  nothing that isn't already broken (spec already declares their migration a non-goal).
- The family-model spec (docs/design/family-model-spec.md:250) already DESIGNED patch
  semantics (omission = unchanged, null = delete) — nothing implements it; both parsers run
  `MissingMemberHandling.Error`.
- Hardest seams for convergence: the two geometry languages (frames vs plane-pair spans;
  nestedFamilies/arrays have no old counterpart), type-major vs param-major per-type values
  (the profile can't even say "this type exists with no overrides"), and total-vs-partial +
  selector duality colliding with strict parsing and planHash determinism.
- Small correct-now win regardless: point `familyfoundry.project` at the surviving schema.

## Round-2 settlements (2026-08-16)

- **Live-lane family switching**: sibling-project activation is unreliable in Revit and must
  NEVER be attempted. Honest refusal in the live lane's family slot; "open .rfa from recents"
  is the legitimate future entry affordance (SHIMS intentional gap).
- **`family.editor.apply` concurrency**: accepted for the manual e2e; SHIMS shim 8. Guard
  design follows the drift vocabulary, not precedes it.
- **Materialize ceremony**: foundry-grade — human-readable reason, planHash-style drift
  refusal, receipts — presented as an arming preview strip. Never hover-height.
- **A-mode**: drill-in from the cross-type table's type column header; Esc returns.
- **Anatomy**: stays a collapsible visual pane in the main lane (today's shape), wired to the
  one-focus law.
- **Schema survivor**: `FamilyModel` (family.json) is THE portable profile. One system, not
  two. Patch semantics (omission = unchanged, null = delete) + coverage markers grow on it;
  selector stays OUT of the document (/families passes explicit familyIds); imperative op
  toggles re-express as end-state or move to run-options. Legacy profiles: SHIMS shim 9 —
  MechEquip/ElecEquip/PlumbEquip essential, CustomFams first migration priority, SavedEquip
  kept for parameter tables. Migration timing neutral; one-shot converter once patch
  semantics land. `familyfoundry.project` retarget HELD until then.

## Round-3 settlements (2026-08-16)

- **Verdict affordance: v3 (rail marker) wins** — instrumented for the multi-proposal-per-row
  case (one row, proposals at different types must be locatable per cell). v1/v2 dropped.
- **Typing beats proposing.** A user edit on a proposed cell severs the proposal linkage
  entirely — the user's value stands, no accept/deny needed. (Also fixes: proposed cells
  currently steal focus and cannot be typed in.)
- **No family-value column.** Misleading — reads as a fourth type. Inheritance keeps showing
  through as placeholders; formulas display on the parameter identity, not a value column.
- **Drill-in stays**, with: layout normalized to the cross-type table (same MasterTable
  primitive if cell styling allows), a clearer back-to-all-types affordance, live numbers
  LEFT-aligned.
- **Drift vocabulary stays six states.** Instance parameters carry per-type DEFAULTS in the
  .rfa; from the family editor's perspective instance vs type differ only in formula
  constraints — instance live values compare and drift like any other. (Corrects a round-2
  assumption; `per-instance` state reverted.)

## Round-3.5 outcome (2026-08-16)

Ghost-row law implemented in `?variant=e`: rows derive from the draft, binding is a visible
move (bind-to-existing discards the literal; new-param-from-this keeps it — geometry stays
byte-identical, only reachability changes). Constituent + parameter inspector docked in the
doc pane's lower half; family value/formula edit there. MasterTable expressed the drill-in
via shared column factories (primitive held; only a row-spanning strip is inexpressible —
replaced by a per-drifting-row verb column, better anyway). Builder friction queued as
round-4 frontier: ghost literal's column home; ghosts in drill-in; bottom-sort override;
bind-to-existing value preview; silent empty-commit refusals; geometry on the LIVE
capture/apply spine (fixture is silent there).

## Round-4 settlements (2026-08-16)

**THE CELL-STATE LAW (user).** A param value has three dimensions, in order of importance:
parameter name, family type, and a PSEUDO-dimension (proposed/grounded/live/saved). The
first two are the grid; the third is never a column — it renders as cell states or
table-wide togglable overlays. Equivalently: for any cell, the useful information is the
DIFFS from the page-state/staged value to (a) the saved profile, (b) the live params,
(c) pea's proposed set.
- proposal → triangle corner chip (as built)
- grounded → underline on the cell
- live → whole-table overlay toggle that visually replaces the draft values (the LIVE
  column DIES); drift legible per cell under the overlay
- saved/unsaved → conveyance open — design candidates: per-cell unsaved marker + the
  header dirty fact
**Ghost rows**: the literal renders as one MERGED cell spanning the type columns (the
honest shape of "no per-type spread"), editable there. Ghosts stay pinned below params
regardless of sort (bottom is law). Ghosts stay out of the drill-in for now.
**Geometry readback (live) is OUT OF SCOPE** — not reliable at satisfying cost; geometry
is authored-side only and reaches Revit through the materialize ceremony.

## Round-5 settlements (2026-08-16) — color/component standards

- **Role-token layer adopted** (docs/design/COLOR-ROLES.md; tokens in styles.css). Meaning
  assigned in ONE place; retro color changes are one-line. Proposals wear pea green
  (`--st-proposal`), pe-blue is commit+focus only, mode-selection is a mist fill, safe-verb
  hover never turns blue. Shape law: triangle=proposal, dot=unsaved, underline=ground/drift.
- **Promoted primitives**: `ui/verb.tsx` (tone: commit|act|nav, reason required),
  `ui/switcher.tsx`, `ui/chip.tsx` (dashed = seam, reserved).
- **Drill-in refit (user ruling)**: per-row cross verbs removed — pane-header capture/apply
  are the only crossing surfaces; profile column right-aligns, live left-aligns, meeting at
  the spine as one diff per row.
- Migration order: variant-e proves the vocabulary; whole-app sweep is a bounded follow-up
  mission (possibly this session).

## Open frontier

- **Geometry metadata exposure (round-3.5, user-flagged 2026-08-16).** The mocks flattened
  geometry to prose; the original route was already thin here. Required: editing a geometry
  constituent's metadata AND its parameter associations. THE GHOST-ROW LAW (user, 2026-08-16):
  every param-BINDABLE geometry property is visible in the master table — if BOUND to a param
  it is represented by that param's row; if UNBOUND it renders as a ghost row (still editable
  as a literal), sorted to the bottom. Binding promotes a ghost into its param's row.
  NON-bindable properties (direction, orientation, systemType, flowDirection, frame) live
  elsewhere — constituent focus → sidebar inspector editing, composed with the one-focus law.
  Fixture needs structured constituents (not strings) plus at least one unbound bindable dim.
- Round-2 prototype questions (answered by mocks, not grilling): citation density at many
  proposals; doc-pane two-mode switch; centralized apply list in doc pane; A-mode drill-in
  feel (v3 + drill-in settled in round 3).
- Materialize op path for one family (foundry apply with familyIds=[one] vs a new op) — after
  schema survivor work starts.
- /families UX revisit (user-flagged, separate exercise).
