# Family rewrite — live effort map (2026-09-06)

Delete this file when the effort ends; verdicts fold into LEDGER.md. The previous map (portability
oracle waves + review board rounds, 2026-08-18/19) was swept on 2026-09-06; its surviving items are
Owed lines in LEDGER.md and git history holds the rest.

Effort: demiurge + purge rewrite of the Family Foundry compiler and Revit-to-json roundtrip.
Orchestrator session notes and every line report: `.artifacts/handoffs/family-rewrite-20260906/`.
Herdr session `famrw` on the main checkout; Revit session `pe.app-25` (2025) holds `PE Bath-Shower.rfa`
and `PE GRD Exhaust.rfa`.

## Rounds

- Round 1 (paper, nine lines) — DONE 2026-09-06. Verdicts in LEDGER.md under "Family rewrite".
  Shapes: s-typed KILL (verbosity, worse errors), s-dsl ADOPT for slot grammar, s-native ADOPT for
  geometry substrate with macros, s-reconcile ADOPT.
- Round 2 (paper) — schema as C# records + JSON Schema + the three examples (r2-schema); reconciler
  refit to the native schema, transaction flag, `run` block (r2-reconcile); live proof of the
  reference-line rotation path and read-only `EditFamily` (r2-revit); adversarial critic on a clean
  line (r2-critic).
- Round 3 — pea re-authors the three families against the round-2 schema; then code lands on the
  dirty tree (arch on paper, then feel).

## Frontier (decisions whose prerequisites are settled)

- `parameters` merge (`familyParameters` + `sharedParameters` into one map with `shared: true`)
  versus two maps. Both Opus lines merged; the ledger's name-first shared law holds either way.
- `dataType` closed token set (14 tokens proposed) versus Revit UI labels. The corpus spread is
  unknown; c-corpus can count it.
- Localization of template plane names (`Center (Left/Right)` is English). Alias table or
  `plane:family.*` tokens kept as the only invented names.
- Whether the SVG oracle survives (native needs a 1-D solver per axis) or dies with frames.
- Sweeps, blends, revolves: the 2026-08-18 "unmodeled forever" ruling is reopened by the native
  substrate; keep closed until a checked-in family forces one.

## Round 2 findings (2026-09-06, reports r2-*.md)

Live-proven in `pe.app-25` (r2-revit): puck rotation is a labeled `AngularDimension` between a fixed plane
and a reference line whose start is pinned by two alignments, with the extrusion sketched on the line's
endpoint plane; `SketchPlane.Create` on a reference line or its endpoint is refused by all three public
signatures (gotcha 27 reconfirmed), so that geometry is UI-only; a work-plane-based nested instance hosted
on a line endpoint follows the endpoint position but does NOT rotate under API placement; host alignments
to a nested instance resolve by `FamilyInstanceReferenceType` and `GetReferenceByName`, no `EditFamily`
needed; every GRD sketch line is locked to exactly one named plane; `BaseArray.Name` is not persisted and
`ArrayAnchorMember` is create-time only.

Critic (r2-critic) findings that amend round-1 verdicts, each PROVEN against code or corpus:
- F5 `Diff` compares a portable literal to a Revit display string (`GetValueString` emits `1' - 0"`);
  550 of 561 corpus per-type cells fail the portable regex. Normalize both sides through
  `UnitFormatUtils` with the parameter spec; pass a `UnitResolver` into `Reconcile`.
- F6/F9 capture emits no unmodeled entry for what it did not read (non-array nested families return early
  at `FamilyModelCaptureExtensions.cs:104`). Add a per-section `coverage` record beside `unmodeled`; any
  change in a `not-read`/`partial` section is Unverifiable by construction.
- F7 capture hoists a uniform per-type value onto the parameter; canonicalize cells on both sides before
  diffing.
- F1 fold-back by plane name matches zero real families and fails quiet; macros expand at parse time and
  never fold back.
- F2 `Ref. Level` is a Level, not a ReferencePlane; split `datums` (levels + template planes, alias table)
  from `refPlanes` (author planes, `DATUM_PLANE_DEFINES_ORIGIN == 0`).
- F10/F11 four Zehnder duct connectors share one face; a connector's face is its own stub's face and may be a
  tangent plane. Connectors address their sketch plane plus two positioning planes: `{ on, at: [a, b] }`.
- F13/F14 `select` needs `categories[]` and `placedOnly`; `blanksBecome` is a spec-keyed list, never one
  scalar (a blank Length would become minus one foot; a blank Yes/No would flip on).
- F15/F16 a transaction flag cannot deliver scripts: `EditFamily` and `LoadFamily` throw under a caller-held
  project transaction (gotcha 25). The missing primitive is `FamilyVisit` (park or defer, coalesce, verify
  load); the ops library is unproven inventory until one pod renames a parameter across three families
  through it, live.
- F17/F18 the length grammar must accept feet-inches; `dataType` is a canonical spec token with labels and
  forge ids accepted on input (corpus: two spellings of one spec plus 35 nulls).
- F19 `refLines` has no proven compiler and no corpus instance; keep it as a capture noun, refuse
  `forms` sketched on a line.

## Needs kaitpw

- Macros: parse-time sugar only (capture emits the expanded form; the reconciler still converges) versus
  fold-back by name (quiet failure, zero real matches).
- `FamilyVisit` in scope for this rewrite, or Owed with the ops library marked unproven inventory.
- `refLines` kept capture-only, or cut until a live probe proves a compiler.
- Recreate-on-any-change for planes, dims, forms, nested, arrays, connectors versus in-place edits for the
  few fields Revit allows (strength, subcategory, label, association).
