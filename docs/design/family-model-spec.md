# Family Model (`family.json`) — design spec

Status: v1 and v1.1 implementation complete; Phase 5 is a documented public-API boundary, the Phase 8
source-sandbox walkthrough is proven, and Phase 9 converges disk, UI, Pea, scripts, validation, and Revit evidence on
one Family Model/settings language. Captures the design review and constraint digest of 2026-07-15 through 2026-07-16.
Owner surfaces: FamilyFoundry (FF). Consumers: FFManager, FFMigrator, capture, replay, Pea, host operations, web preview.

## Implementation ledger

### 2026-07-16 — Phase 9 authoring/evidence convergence complete

- `FamilyFoundry/models` is a first-class settings root. The beta Family Model route and chat plugin project the same
  `SettingsDocumentId`, authored/composed content, validation, version token, proposals, and staged review state used
  by Pea and scripts. The specialized renderer owns no Family Foundry semantics.
- `settings.document.validate` remains the single public PE JSON validation operation. The TS settings host composes
  structural and feature-semantic issues; a small internal validator registry in `Pe.Revit.SettingsRuntime` supplies
  Family Model semantics without publishing a Family-specific validation operation.
- `revit.detail.family-model` returns resolved per-type value/source/provenance evidence beside authored `modelJson`.
  C# and TypeScript consume one checked-in evaluator conformance vector for axes, face coordinates, primitive bounds,
  frame origins, and centered-array math.
- The settings route gained create-only document creation, explicit property deletion, and bound-session routing.
  Successful saves re-open the canonical document so raw content, composed content, validation, and version metadata
  cannot describe different revisions.
- The former POC is now `/beta/family-plugin`; `/family-model` redirects there. Educational presets and the GRD
  showcase remain, while document lifecycle, validation, and save flow come from the generic settings route.
- Live Pea thread `5e0b53e5-bb7e-4236-8682-fbb85abe8df6` created
  `FamilyFoundry/models/proof/pea-live-width-20260716-v2`, proposed Width changes, stopped at the human save boundary,
  and then consumed the human-approved `21in` document. Pea called `revit.apply.family-model`,
  `revit.apply.document.open`, and `revit.detail.family-model`, all explicitly targeted to
  `sandbox:ff-family-model-r25`. Revit evidence returned Width `1' - 9"` with source `AuthoredGlobal`, provenance
  `Exact`, and zero unmodeled diagnostics.

### 2026-07-15 — Phase 8 automated gates complete

- FreshRevitProcess 2025 passes all four `FamilyModelRoundtripTests`: minimal box, showcase, centered GRD array, and
  recursive GRD/vane dependency roundtrip.
- The separate GRD room fixture proves the opening-side calculation point structurally and retains the final exported
  image under `.artifacts/build/Pe.Revit.Tests/Debug.R25.Tests/visual-proof/grd-room-proof.png`.
- The exact source sandbox `ff-family-model-r25` built the minimal box, showcase, and GRD/vane profiles through the
  public `revit.apply.family-model` operation. It opened all three RFAs sequentially, applied 1/3/3 type edits with zero
  failures, and captured the final active states under `.artifacts/family-model-walkthrough/`.
- The final walkthrough used generation `20260716052344454`, PID `41160`, and build stamp `6580a841097a`; the SDK
  armed no-save and stopped that exact sandbox gracefully. The generated RFAs, PNGs, and full validation/build/flex/
  before-after snapshot transcript are retained under `.artifacts/family-model-walkthrough/`, with
  `walkthrough-report.json` as the entrypoint. They are disposable evidence, not checked-in source.

### 2026-07-15 — Phase 7 product surface complete

- `revit.detail.family-model` and `revit.apply.family-model` are public typed bridge operations discovered from the `Pe.App`
  shell. They schedule through the existing Revit task queue and delegate capture/build behavior to the document-owned
  Family Model APIs; no parallel compiler or package cycle was added.
- The generated TypeScript host contract exposes those operations to the host and Pea's generic operation caller.
- `/family-model` is the intentionally dumb Manager surface: open or edit `family.json`, select a type, inspect authored
  values and named constituents, validate through the authoritative C# model, capture the active family, and build to an
  explicit `.rfa` path plus dependency directory when required. It preserves formulas, references, frames, and units as
  authored strings and never guesses geometry.
- Focused preview tests, TypeScript compilation, host-contract tests, and the `Pe.App` source compile are the no-RRD
  proof. Live capture/build remains normal product-runtime proof, not a prerequisite for the portable compiler contract.

### 2026-07-15 — Phase 6 installed-year proof complete

- FreshRevitProcess 2023 and 2024 pass the minimal box, showcase, and default-state GRD/vane roundtrips with portable
  target-year dependencies and empty recovery metadata.
- Revit 2023 and 2024 natively reject setting the centered-array half-count parameter to zero. The focused flex test
  therefore reports that exact compatibility limitation; the authored model does not encode a year workaround.
- FreshRevitProcess 2025 passes the GRD room-facing visual/structural proof and GRD/vane roundtrip. Revit 2026 passes
  the complete four-test `FamilyModelRoundtripTests` fixture.
- The only cross-target source adjustment was replacing `MaxBy` with `OrderByDescending(...).First()` for the
  .NET Framework targets; model semantics are unchanged.

### 2026-07-15 — Phase 5 public-API spike closed

- The hand-authored puck constitution is understood and checked in as the exact Revit 2025 compiler resource. Its
  reference line, picked-endpoint work plane, angular dimension, diameter/visibility associations, and face-hosted
  Connector flex correctly at 0°, 10°, and 90°.
- Revit's public API cannot recreate the picked reference-line endpoint as the extrusion work plane: every public
  `SketchPlane.Create` route rejects the available reference-line references as non-planar. This is the native-resource
  boundary; no metadata or hidden recovery state is used.
- A generated host with three loaded puck instances still stalls at the real bath/shower 90° → 0° type transition.
  Removing compiler-added center-plane constraints to match the source topology did not resolve it. The generated
  plumbing compiler path is therefore not checked in or represented as supported authored syntax.
- Pipe Connector Fixture Units is independently non-replayable through the public API: both the capability check and
  direct association call reject it.

Decision: stop the spike, ship `Resources/Native/2025/puck.rfa`, and continue the remaining Family Model work. Resume
plumbing composition only with a new concrete native-hosting recipe or a user-guided recreation sequence—not further
speculative API permutations.

### 2026-07-15 — Phase 4 structural and black-box proof complete

- The checked-in source GRD proves one narrow native convention: two labeled half-arrays share one centered nested
  vane; the endpoint placeholders align to the opening limits; the nested `_vane length` parameter associates to the
  host opening length. Generated groups and equality dimensions remain evidence, never authored fields.
- `nestedFamilies.<slug>` now declares only dependency, Revit type, `frame:family`, and host-parameter bindings.
  `arrays.<same-slug>` exposes only `CenteredLinear`, member, planar axis, Integer half-count driver, and named
  start/end planes. The shared slug comes from the observable loaded family name, so capture needs no hidden ID.
- Dependencies resolve by package convention from `dependencies/<slug>.family.json`, rebuild recursively from the
  target-year template, and are saved only to a disposable target-year `.rfa` before loading. Generated RFAs are not
  source artifacts.
- The compiler reproduces the hand-authored Revit sequence: expose strong named center references in the dependency;
  align the seed; create two arrays anchored at their far endpoints; move endpoint groups onto limit planes before
  locking; label both arrays at a safe count of two; then restore the formula so native 0/1 placeholders work.
- Capture recognizes that exact observable topology from a reopened RFA, including endpoint alignments, axis,
  half-count label, dependency/type, and nested parameter association. A different array convention is `unmodeled`.
- Checked in `pe-grd-vane.family.json` and `dependencies/vane.family.json`. The GRD is face/work-plane based and the
  fixed room-point convention resolves to one foot along `-Y`, its opening side.
- FreshRevitProcess 2025 proves half counts 0, 1, 8, and 19, shared center identity, endpoint locks, all copied members
  remaining between limits, exact A → capture → B → capture JSON convergence for both profiles, empty `unmodeled`,
  and no DataStorage/extensible-storage recovery metadata.

The generated GRD was placed against the room-boundary fixture in FreshRevitProcess 2025. Its calculation point resolves
inside the opening-side room while the mirrored back-side point remains outside; the exported visual proof is retained
under `.artifacts`. A legacy snapshot/apply GRD regression remains separate from this portable Family Model path.

### 2026-07-15 — Phase 3 complete

- Checked in `family-model-showcase.family.json` plus a short engineer/agent walkthrough. It covers three types,
  a formula, offset planes, solid and void prisms/cylinders, four explicit frames, round/rectangular duct, pipe,
  electrical Connectors, inward/outward stubs, parameter associations, and the fixed room calculation point.
- `frame.normal` and `frame.up` now control the resulting Connector orientation while the Revit sketch plane remains
  associated with its driving reference plane. Recreating an equivalent free sketch plane looked correct once but
  detached the stub during type flex; the associated-plane rule is now called out at the implementation hotspot.
- Capture derives the frame and face-relative stub direction from the observable Connector coordinate system. Revit
  can choose either direction initially and can swap extrusion endpoints, so replay explicitly aligns both frame axes
  before capture treats them as portable state.
- Capture now recovers the main parametric body alongside Connector stubs, electrical round-stub diameter, and the
  stub-depth family-parameter association. It reports every unmatched extrusion through `unmodeled`.
- FreshRevitProcess 2025 proves exact A -> capture -> B -> capture JSON convergence, no DataStorage/extensible
  storage/undeclared parameters, and equal runtime planes, constraints, solids, voids, Connector frames/sizes/config,
  and geometry while flexing Compact, Standard, and Tall. The Phase 2 minimal-box proof remains green.

### 2026-07-15 — Phase 0 baseline

- Worktree created at `C:\Users\kaitp\source\repos\Pe.Tools-family-model` on `codex/family-model`.
- Isolated `Debug.R25` compile of `Pe.Revit.FamilyFoundry` passes with zero errors. The clean worktree first required
  a normal restore; the initial `--no-restore` failure was missing `project.assets.json`, not a source failure.
- Existing `PeGrd_Supply_snapshot_apply_aligns_with_runtime_across_existing_type_matrix` passes 1/1 in
  FreshRevitProcess 2025. This is the pre-Family-Model runtime baseline; RRD was not contacted.
- The older Family Foundry README/GOALS still prescribe array-shaped parameter declarations and a centralized
  per-type table. This spec intentionally supersedes those decisions with exact-name maps and per-type objects.
  Update those durable docs in Phase 1; do not add compatibility aliases.
- Current `FamilyFoundryRoundtripHarness` proves authored profile → saved family and snapshot → replay, but not the
  required save/close/reopen A → capture → build B black-box chain. Deepen that harness in Phase 2 rather than
  creating a parallel harness.

Next slice: implement the smallest no-Revit `FamilyModel` contract, strict validator, portable literal/reference
parsers, and a minimal box fixture before adding any Revit mutation behavior.

### 2026-07-15 — Phase 1 vertical slice

- `FamilyModel` now lives in `Pe.Shared.RevitData.Families`: portable authored truth is independent of Revit and
  Family Foundry execution, while `Pe.Revit.FamilyFoundry` owns lowering.
- Strict lower-camel JSON parsing rejects unknown and duplicate fields. Validation covers exact-name collisions,
  value/formula conflicts, formula-backed type overrides, declared parameter references, solid profiles, and the
  fixed `frame:family` starting convention.
- Portable references preserve exact Revit parameter names. Portable length literals accept decimal, fraction,
  mixed-fraction, and metric forms; lowering normalizes only at the legacy execution seam.
- The first lowerer supports family/shared parameters, explicit family type names, Prism/VoidPrism,
  Cylinder/VoidCylinder, and deterministic family-frame geometry. It compiles through the existing
  param-driven-solids compiler without changing `OperationProcessor` or FamilyProcessor.
- Empty family types remain explicit on `FamilyModelLoweringResult`; they are not encoded as fake per-type parameter
  assignments merely to satisfy the legacy `CreateFamilyTypes` discovery mechanism.
- Generated Revit plane names use logical solid slugs, never display labels. Observable names are the only available
  roundtrip identity because hidden metadata is forbidden.
- Generated schema validates the authored lower-camel shape. Category, parameter data type, and properties group use
  live value domains. Current schema metadata does not hydrate dictionary keys; add one focused key-options extension
  when the web/form slice consumes parameter maps rather than regressing the model to arrays.
- Proof: 7 shared contract tests pass without Revit; 3 lowerer/schema tests pass in FreshRevitProcess 2025.

Next slice: create the minimal family from its declared template, seed explicit types, apply the lowered profile, then
capture it from a saved/reopened document into a new `FamilyModel` without access to the original model.

### 2026-07-15 — Phase 2 black-box kernel

- `FamilyModelBuilder` now resolves an installed target-year template by portable template name, verifies its observed
  placement, configures category/name, seeds explicit empty family types, and applies through the existing FFManager
  executor. It never applies geometry to an arbitrary preexisting family.
- Capture accepts only a reopened family `Document`. Revit does not retain the source `.rft`; the first proven capture
  convention infers `Generic Model` from observable Generic Models + Unhosted state. Unknown conventions become
  `unmodeled`, never recovery metadata.
- The minimal family-frame prism decompiles from observable named planes and associations. Logical solid identity is
  recovered from the generated `<slug>.left/.right/.back/.front/.top` plane names, not from ElementIds or hidden state.
- `roomCalculationPoint` is implemented at its locked minimal surface: omitted or `{ "enabled": true }`. Apply uses the
  existing one-foot host-derived convention; capture recognizes that exact observable state and quarantines deviations.
- FFManager no longer injects `_FOUNDRY LAST PROCESSED AT`. FFMigrator was intentionally left unchanged and bulk
  migration was not rerun.
- `FamilyFoundryRoundtripHarness` now owns the required build A → save/close/reopen → capture from A → build/save/reopen
  B chain. The test compares captured serialization, types, parameter values, named planes, dimensions, and solid
  bounds, and rejects undeclared family parameters, `DataStorage`, or extensible-storage entities.
- Proof: `Minimal_box_roundtrips_from_reopened_Revit_state_without_metadata` passes 1/1 in FreshRevitProcess 2025;
  source compile passes with zero errors. RRD was not contacted.

Next slice: prove the portable reference/plane/frame vocabulary needed before arrays, nested vanes, and connector pucks
can share one spatial language. Keep each addition tied to a checked-in example; do not expose generic transforms first.

## Outcome

One portable **Family Package** — `family.json` + recursive `dependencies/` + `resources/` + `proof/` — that:

- an MEP engineer or agent can write by hand with only schema/LSP help (boxes, cylinders, Connectors first);
- a web view can render with a dumb evaluator (params → arithmetic → plane intersection → face lookup), zero Revit semantics;
- a scanner can understand at a glance (what is it → knobs → shape → connections);
- UI, Pea, scripts, and disk authoring address the same settings document and speak the same Family Model language;
- rebuilds behaviorally-equivalent families across Revit years. ElementIds, byte identity, and Revit-generated artifacts (array groups, equality dims) are **evidence, never authored state**.

Pipeline: open/capture → authored model → validate → resolve/flex → evidence projection → compile → Revit apply →
snapshot + structural diff + images. Evidence, snapshots, and images are checkpoints, never a second source of truth.

Roundtrip is the north star, not a reason to falsify compatibility. Capture and replay may use only portable authored
state plus observable Revit family state. **Never persist Family Foundry metadata in extensible storage, hidden family
parameters, `DataStorage`, or equivalent side channels to make capture or tests succeed.** If an existing convention is
not representable, capture reports it under `unmodeled`; replay does not pretend otherwise.

The governing implementation rule is Occam: expose the smallest deterministic surface that covers a proven MEP case.
Prefer one powerful default over a configurable Revit abstraction. Add a setting only after a real family cannot be
expressed without it.

## Locked shape decisions

1. **Name-keyed maps, not arrays**, for every named section: `familyParameters`, `sharedParameters`, `types`, `planes`, `frames`, `solids`, `nestedFamilies`, `connectors`, `arrays`, `symbolics`, `companions`. Names are identity (no raw Revit IDs). This gives Migrator merge-by-name for free, LSP key completion, and structural dedupe.
   - `familyParameters`, `sharedParameters`, and `types` are keyed by their exact Revit names. Do not create a second slug identity for `_conn size` or a family type.
   - Model constituents (`planes`, `frames`, `solids`, `nestedFamilies`, `connectors`, `arrays`, `symbolics`, `companions`) use logical slugs with an optional Revit/display `label`.
   - Canonical `family.json` contains no deletion tombstones. FFMigrator patches use omission = unchanged and `null` = delete.
   - Breaks the current `DesiredPerTypeAssignmentRow` (Parameter column + dynamic type columns). Replace with per-type objects:
     ```json
     "types": { "Lavatory": { "_conn size": "1/2in" }, "Service Sink": {} }
     ```
     Empty/uniform types stay visible and preserved. `Planes` is already a dictionary in `AuthoredParamDrivenSolidsSettings` — extend that pattern, don't invent a new one.
2. **One reference micro-DSL.** Prefixes: `param:`, `plane:`, `frame:`, `face:`, `nested:`, `dependency:`. Parameter and type references preserve exact Revit names; other reference targets use logical slugs. Face refs are `face:<solid>.<FaceName>`.
3. **Portable literals are canonical truth**: unit-carrying scalars such as `"1/2in"` and `"0deg"`, plus closed axis tokens such as `"-Y"`. One parsing grammar and conformance-vector set lives with the schema; C# and TypeScript consumers implement that same grammar. Non-negotiable for hand-authorability.
4. **`value` XOR `formula`** per parameter, schema-enforced. Formula-driven params cannot appear in per-type values (authoring-time error, not apply-time). Renames/mappings ride on the param entry (`mappedFrom`), not a parallel migration block.
5. **Closed v1 geometry vocabulary.** Solid kinds: `Prism`, `Cylinder`, plus void variants. Each kind enumerates its named faces in the schema (Prism → Front/Back/Left/Right/Top/Bottom; Cylinder → Top/Bottom/Side). Reference planes are **axis + param-driven offset only**. Anything a `frame:`/`face:` ref can point at is resolvable by the dumb evaluator. New kinds arrive as enum members, never as an open geometry language.
6. **`Frame` is the universal spatial primitive** (origin, normal, up, optional rotation) shared by solids, Connectors, nested instances, symbolic graphics, companion placement, Revit apply, and Three.js. Frame origins resolve from plane intersections or explicit coords.
7. **Connector owns its visual stub inline** (the plumbing puck). One authoring site for the connector + puck coupling; bindings (`diameter: "param:_conn size"`) live beside what they drive. The stub inherits the Connector's frame, shape, and size. Its minimal authored surface is optional `angle` and `visible` bindings; the nested-puck implementation is compiler-owned. Do not expose a generic visual-family path, duplicate transform, or second size declaration until a real family requires it. Connector vocabulary is Revit/engineer terminology — domain, systemType, shape, frame, sizing, configuration, fixtureUnits; never "Port". Open experiment: whether puck angle drives actual Connector orientation (Phase 5 proof).
8. **Presets are macros**, not schema primitives: square/circular vent symbolic, puck pattern, clearance companion. They expand to base primitives at compile time. Known cost: capture emits the expansion, not the preset (round-trip asymmetry). Preset re-recognition on capture is **deferred**; the expansion must therefore be clean, minimal base-primitive output.
9. **`unmodeled` section** resolves single-source-of-truth vs never-silently-normalize: captured state the schema can't express lands in a top-level `unmodeled: [...]` block (raw facts + reason code). It is an honesty ledger, not an authored or executable escape hatch. Compiler refuses to apply it; web preview renders it as warnings. Behavioral roundtrip equivalence may be claimed only when `unmodeled` is empty for the tested contract. Sibling escape hatch: generic `associations: []` edge list for unusual native parameter associations, visibly ugly on purpose.
10. **Arrays**: `CenteredLinear` compiles to two half-arrays sharing one center member (`total = 2n − 1`); endpoint members align to named limit planes; counts 0/1 and Revit placeholder members handled safely. On capture of existing families, anchor choice may be inferred — **write anyway, emit a confidence diagnostic**; no interactive approval gate (FF ships as a public NuGet lib; capture→approve→resume flows don't port).
11. **Room calculation point is first-class**: `roomCalculationPoint` section in the model. User surface stays exactly `{ "enabled": true }`. The intentional PE convention remains fixed at a one-foot offset with direction inferred per placement type (Unhosted → +Z, FaceHosted/WallHosted → −Y), as `AddRoomDingler` does today. The compiled plan and snapshot express the resolved direction using the same Frame vocabulary as other spatial constituents, but authored settings expose no frame, direction, or offset override. Capture projects the PE default back to `{ "enabled": true }`; a non-default configuration is `unmodeled` until a real family proves that another public shape is necessary.
12. **Minimal-surface rule** governs everything above: users author only what they must; anything else is an internal heuristic with a diagnostic, or deferred entirely. The canonical doc example is the **minimal family** (~15 lines: name, category, template, one param, one prism); the full sink example comes second.
13. **Document order = reader order**: definitions first (`family` header, parameters, `types`, `planes`, `frames`), content second (`solids`, `nestedFamilies`, `connectors`, `arrays`, `symbolics`, `companions`, `roomCalculationPoint`), quarantine last (`associations`, `unmodeled`). Every content section optional.
14. **Properties-group metadata is already the parameter grouping contract.** `familyParameters.*.propertiesGroup` and
    `sharedParameters.*.propertiesGroup` remain optional, LSP-completable value-domain fields. UIs group the parameter
    matrix and anatomy register by this value, with an ungrouped fallback. Do not add a second UI-only grouping field.
15. **Types stay metadata-free in v1.1.** The first type in document order is the initial preview type. Do not add
    `default`, description, tags, or constituent visibility syntax until a checked-in family requires one of them.
16. **V1 solid placement is explicit and intentionally narrow.** Every solid uses `frame:family`, is centered on the
    family left/right and front/back planes, starts on the family bottom plane, and extends in the positive family Z
    direction. Non-family-frame solid placement and type-conditional constituent existence are unsupported, not
    inferred. Add either only with a checked-in roundtrip example.

## Authored model and evidence model

`family.json` stays authored truth. Do not add evaluated formulas, resolved coordinates, generated array members,
capture confidence, or Revit identifiers to it.

Family Foundry also exposes a typed **Family Model evidence projection** for consumers that need comparison and
contextual clues without reimplementing Revit behavior. The projection is returned by Family Model detail/capture
work and may be persisted under `proof/`; it is never accepted as build input.

The minimum evidence contract is:

- resolved parameter values by family type, preserving the authored parameter and type names;
- value source: authored global value, authored type override, formula, Revit/default state, or unresolved;
- formula text when the source is formula, plus the resolved display/portable value when Revit can report one;
- path-addressed diagnostics with provenance (`exact`, `inferred`, or `unresolved`) and an optional confidence/message;
- enough resolved parameter values for a dumb consumer to evaluate declared planes, solids, frames, Connectors, and
  centered-array member counts without parsing Revit formulas.

The evidence projection does not need a second geometry model. Consumers combine it with `family.json` and the
normative evaluator rules below. If a value cannot be represented portably, return it as unresolved with a diagnostic
rather than inventing a literal.

### Normative dumb-evaluator rules

The portable evaluator contract is part of the Family Model specification, not folklore in the C# lowerer:

- family axes are right-handed: +X is right, +Y is Front, and +Z is up; Back is -Y. This follows the current lowerer,
  which emits the back depth plane as the negative `@CenterFB` span and the front plane as the positive span;
- the built-in family planes are `@CenterLR` at X=0, `@CenterFB` at Y=0, and `@Bottom` at Z=0;
- `direction: Out` moves along the referenced plane's portable positive normal; `In` reverses it. The conformance
  vectors lock the built-in and derived-plane normals so consumers never infer them from labels;
- prism width is symmetric about `@CenterLR`, depth is symmetric about `@CenterFB`, and height runs from `@Bottom`
  toward +Z;
- cylinder center is the intersection of `@CenterLR` and `@CenterFB`; height runs from `@Bottom` toward +Z;
- named faces resolve from those bounds; frame origins resolve after planes and faces; arrays resolve after their
  member, axis, limit planes, and half-count;
- formula text is opaque to browser/agent evaluators. They use resolved evidence when available and otherwise mark the
  dependent value unresolved.

Keep one checked-in conformance-vector file beside the portable literal/reference vectors. It must cover axis signs,
plane `Out`/`In`, prism/cylinder bounds, face coordinates, frame origins, and `CenteredLinear total = 2n - 1`.

## Settings-document and host-operation architecture

The Family Model editor is a projection over a settings document, not the owner of a separate file format or storage
API. Disk files under the Windows Documents known folder (including OneDrive redirection), the Family Model UI, Pea,
and scripts use the same `SettingsDocumentId`, raw content, composed content, validation result, and version token.

Register `FamilyModel` as its own settings root under a feature-named Family Foundry module. Do not rename the existing
command-named FFManager/FFMigrator roots in this slice. The exact disk shape remains the generic settings layout:

```text
Documents/Pe.Tools/settings/<family-foundry-module>/<models-root>/<relative-path>.json
```

The public lifecycle is:

```text
settings.document.open
settings.document.validate
settings.document.save
```

- `settings.document.open` is the single read path for UI, Pea, scripts, and disk-backed chat work.
- `settings.document.validate` is the single public validation operation for all PE JSON. The dedicated
  `revit.detail.family-model.validation` operation is removed once Family Model validation is routed through it.
- `settings.document.save` owns optimistic concurrency and writes the same file an external editor opens. Saving a
  draft may return validation errors; build/apply must refuse structurally or semantically invalid content.
- The Family Model chat plugin stages and saves through these operations. It must not write paths directly or invent a
  second Family Model document state.

Family-specific host operations remain only for reusable Revit abilities:

- `revit.detail.family-model` captures the active family and returns authored `ModelJson` plus evidence/provenance.
- `revit.apply.family-model` builds an explicit authored `ModelJson` to an explicit `.rfa` path.

These operations remain JSON/script-friendly and do not require the UI renderer. A UI may join settings open/validate/
save with detail/apply, but the host does not expose a page-shaped Family Model endpoint.

### Validation ownership

One validation result merges three distinct phases:

| Phase | Meaning | Example | Owner |
| --- | --- | --- | --- |
| Structural | JSON syntax and generated-schema shape | required field, enum, unknown property | settings host + schema |
| Semantic | deterministic meaning inside the authored/composed document | missing reference, formula/type override conflict | feature validator |
| Contextual | compatibility with the connected Revit document/session | template or system type availability | feature validator using Revit context |

`settings.document.validate` always runs structural validation. It then invokes a registered feature validator for the
bound settings type when one exists. Family Foundry registers `FamilyModelJson.Parse`/`FamilyModelValidator`; Settings
Runtime does not learn Family Model rules.

The internal validation request carries both raw and composed content. Raw content is required for duplicate-key and
strict-member detection; semantic validation normally inspects composed content. Contextual validation reports
`unavailable` when its required Revit context does not exist rather than marking the document invalid.

Keep `ISettingsRootBinding` structural. The smallest acceptable Settings Runtime extension is a registry of validation
functions keyed by bound settings type; do not add feature behavior to `Pe.Shared.StorageRuntime`.

### Schema, field options, and UI discovery

JSON Schema remains the shared structural/LSP contract. Standard JSON language servers provide completion, hover,
examples, and structural errors; semantic/contextual diagnostics come from `settings.document.validate`. Do not build
a custom language server in this slice.

- `FieldOptionItem.Metadata` describes an option: identity, datatype, category, compatibility facts, or other context a
  UI/agent can display. It does not encode the relationship graph or choose the Family Model page.
- property-level `x-ui` continues to describe generic rendering such as sections, advanced fields, and the type matrix.
- a root-level `x-ui.renderer = "family-model"` may select the specialized projection. Unknown renderers fall back to
  the generic settings editor/raw JSON editor. Renderer metadata contains no Family Foundry business logic.

This preserves progressive enhancement: disk editors get LSP, generic settings clients get schema-driven editing,
the Family Model plugin gets the rich relationship/comparison view, and Pea gets the same document and operations
without needing any renderer.

## Manager / Migrator split

Both are shells over the same compiler, executor, snapshot, diff, and artifact language. Verbs/operation queues survive only as compiled/debug surfaces, never a competing authored API.

- **FFManager** — creates one new family from its declared target-year template and complete Family Model. V1 does not reconcile this model onto a family that already contains arbitrary geometry. It is the only surface with geometry authoring (solids, frames, arrays, symbolics, companions).
- **FFMigrator** — normalizes many existing families using a partial desired patch and **generalized operations only**: shared/family parameters + per-type values (the existing implemented spec), electrical connector at a geometry-independent family anchor, room calculation point, and possibly clearance-box attach. No face-relative or family-specific geometry authoring in bulk. Merge-by-name; omission preserves and `null` deletes. `select` language frozen at v1: category + name glob; exotic selection goes through scripts producing explicit lists.

They share vocabulary, validation, lowering conventions, artifacts, and proof—not the same mutation capabilities.

Field-option hydration reuses the existing `ValueDomainKeys` schema mechanism; the schema marks which enums hydrate from the live host catalog (categories, system types, line styles, shared param names) vs. static schema.

## Proof discipline

- Pods prove hard Revit mechanics; worktrees isolate architecture changes; main receives proven vertical slices.
- **Flex matrices, not one happy type**, verify geometry, associations, visibility, arrays, Connectors. "Verbatim" = behavioral equivalence across the flex matrix. Flex matrix authorship location: open (Q4 below).
- Visual inspection + serialized state required for geometry/placement/orientation/graphics claims.
- Cross-version proof rebuilds from target-year templates + portable recursive dependencies (a 2026 puck rebuilds in 2024).
- Transaction/document choreography stays behind deterministic document-owned APIs; SDK sandbox targeting only, no-save cleanup, never touch RRD/user documents.
- Known bugs to fix before trusting replay: param-driven-solids per-type value collapse; connector orientation (shared-plane flipping, ignored stub offsets, axis-only inference); nested transform/hosting/flip/visibility capture gaps.
- A roundtrip test is black-box at the authored boundary: build A from a checked-in profile; save, close, and reopen A; capture a new model using only the reopened Revit document; build B from that capture; flex A and B through the same matrix; compare serialized and runtime state.
- Roundtrip tests assert that no undeclared family parameters or FF-owned `DataStorage`/extensible-storage state were introduced. The capture API receives the reopened `Document`, never the original authored model or compiler plan.
- Flex matrices remain test-owned in v1, using the existing C# roundtrip harness. Do not create another public package format until a non-test consumer needs the equivalence contract.

## Checked-in example deliverables

Canonical profiles live under `source/Pe.Revit.Tests/Fixtures/Profiles/family-model/`:

- `pe-grd-vane.family.json` — face/work-plane GRD with nested vanes, `CenteredLinear` repetition, and `{ "enabled": true }` room calculation point. Placement proof must show the point extending from the opening side (the PE "down" convention), never the back side.
- `family-model-showcase.family.json` — one contrived educational family exercising every supported param-driven-solids primitive and Connector profile. A sibling `family-model-showcase.md` explains the sections progressively without duplicating the JSON into several near-identical profiles.
- `dependencies/` — portable nested vane family models required by those profiles. The rotatable puck is the one native exception: Family Foundry ships a target-year `puck.rfa` compiler resource because Revit's public API cannot recreate its reference-line-picked extrusion work plane. Screenshots and other generated `.rfa` files remain test artifacts.

Bath/Shower and WC/Urinal/Bidet profiles are not checked-in deliverables. The Phase 5 spike proved that their picked
work-plane and fixture-unit contract cannot be recreated through the current public Revit API; claiming portable authored
syntax for them would violate the roundtrip contract.

Each profile gets one focused roundtrip test. The tests reuse and deepen `FamilyFoundryRoundtripHarness`; they do not create a second harness or retest the bulk migrator.

## Implementation topology

Use one implementation worktree, created only after this spec is accepted:

- branch: `codex/family-model`
- path: `C:\Users\kaitp\source\repos\Pe.Tools-family-model`
- reason: model, schema, compiler, capture, fixtures, tests, host contracts, and web projection evolve together; multiple worktrees would create merge churn across the same seams.

Do not use RRD for this work. Use:

- **Source compile / no-document tests** for DTO, schema, validation, reference parsing, lowering, and web behavior.
- **FreshRevitProcess 2025** as the default autonomous Revit proof lane during implementation.
- one exact source sandbox, `ff-family-model-r25`, only for interactive visual inspection and the final user walkthrough; restart it for freshness and stop it by id after each visual session.
- **FreshRevitProcess 2023/2024/2025/2026** only after the 2025 profiles are stable, for cross-year portability proof. Start a year-specific sandbox only if a failure is inherently visual and FreshRevitProcess cannot explain it. Never keep multiple visual sandboxes alive.
- `.artifacts/tmp/family-model/` for throwaway Revit API probes. Do not revive or migrate the OneDrive `fam-*` pods.

## Exact implementation phases

### Phase 0 — lock the contract and baseline

Scope:

- incorporate the agreed identity, Manager/Migrator, Connector-stub, formula-preview, `unmodeled`, room-point, Occam, and no-hidden-metadata rules into this spec;
- record the current source compile and focused roundtrip-test baseline without changing FamilyProcessor or running the bulk migration harness;
- create the single implementation worktree.

Exit gate: this document is internally consistent, the baseline failures are known, and no product source has changed.

### Phase 1 — portable model, schema, and lowering seam

Scope:

- add the name-keyed Family Model DTOs, exact-name/logical-slug rules, reference parser, portable literal parser, and strict validation;
- generate JSON schema/LSP metadata and field-option bindings;
- lower the new model into existing FF operation settings and queues. Do not redesign `OperationProcessor` or FamilyProcessor internals;
- keep FFMigrator on its bounded geometry-agnostic patch subset.

Proof: no-document model/schema tests plus source compile. Invalid refs, duplicate identities, formula/value conflicts, formula-backed per-type assignments, and unsupported Migrator geometry fail before Revit.

Exit gate: the minimal ~15-line box profile validates and lowers deterministically.

### Phase 2 — black-box create/capture/rebuild kernel

Scope:

- make FFManager create a new target-year family from the declared template;
- capture supported family state back into the same Family Model shape;
- implement the save/close/reopen A → capture → build B roundtrip harness;
- add room-calculation-point capture/projection for the fixed PE convention;
- add explicit `unmodeled` diagnostics and the no-hidden-metadata assertions.

Proof: a minimal box builds and roundtrips in FreshRevitProcess 2025 with equal types, parameters, planes, solid bounds, room-point state, and an empty `unmodeled` contract.

Exit gate: roundtrip succeeds without the capture path receiving the original profile or compiled plan.

### Phase 3 — educational param-driven-solids showcase

Scope:

- author `family-model-showcase.family.json` and its concise walkthrough;
- exercise prisms, cylinders, void variants, spans, offset planes, frames, materials/visibility where currently supported, round and rectangular duct/pipe Connectors, inward/outward stubs, and electrical Connector behavior;
- fix only the existing param-driven-solids defects that block this supported surface, including per-type value collapse, shared-plane flipping, and ignored stub offsets.

Proof: flex every named type and selected boundary values; compare A/B planes, constraints, bounds, void cuts, Connector origins/frames/sizes/configuration, and declared parameter associations.

Exit gate: the showcase roundtrips in FreshRevitProcess 2025 and reads as an educational example rather than a test-data dump.

### Phase 4 — GRD vanes and opening-side room behavior

Scope:

- implement portable nested-family dependencies and the minimal nested-instance placement/binding state required by the vane;
- implement and capture `CenteredLinear` as two half-arrays sharing the center member, with endpoint alignment to named limit planes;
- author the GRD and vane dependency profiles;
- retain Revit-generated groups/equality dimensions as proof only.

Proof: flex counts 0, 1, 8, and 19 without invalid zero-thickness geometry; verify `total = 2n - 1`, shared center, endpoint locks, parameter label association, placeholder behavior, and A/B member positions. Place the built face/work-plane family against a room boundary and assert the calculation point resolves the opening-side room, not the back-side room.

Exit gate: GRD profile roundtrips with empty `unmodeled` for the declared contract and passes serialized, behavioral, and visual inspection in `ff-family-model-r25`.

### Phase 5 — plumbing fixture composition boundary spike

Scope:

- reproduce the native puck's picked work-plane and Connector associations through public Revit API calls;
- run the puck-angle and fixture-unit experiments;
- if the native relationship is not publicly constructible, retain the exact puck as a compiler resource and do not
  claim the plumbing profiles as portable authored syntax.

Proof: flex the exact native puck and compare the attempted public-API reconstruction, recording the first non-replayable
native relationship rather than persisting recovery metadata.

Exit gate: either the plumbing profiles roundtrip with empty `unmodeled`, or the unsupported public-API boundary is
documented precisely and the profiles remain outside the supported contract. The latter outcome was proven.

### Phase 6 — cross-year portability

Scope:

- rebuild every supported profile and recursive dependency from target-year templates in Revit 2023, 2024, 2025, and 2026;
- use the same semantic/runtime assertions, allowing only documented target-year representation differences;
- keep template/resource resolution explicit in artifacts.

Proof: the focused FreshRevitProcess roundtrip suite passes per installed year, or emits a precise compatibility limitation without changing the authored profile to encode a Revit-year workaround.

Exit gate: cross-year results are summarized in proof artifacts and no year relies on a newer-version `.rfa` dependency.

### Phase 7 — product surfaces and dumb web preview

Scope:

- expose the schema/model through Manager, capture/replay, Pea/host contracts, and the FF web plugin surface;
- render every constituent in the implemented v1 contract directly from `family.json`: params, planes, frame origins
  including face references, solids, nested families and bindings, Connectors and stubs, and centered arrays;
- preserve literals, references, formulas, and units as authored strings; validation and lowering stay in the shared C#
  model, while `unmodeled` facts remain visible warnings and the browser never guesses geometry.

Proof: the supported profiles hydrate through the shared schema/model, compile through the host surface, and render the
same named constituents as the Revit proof artifacts.

Exit gate: a user can inspect a profile, preview it, build it, and follow the same names through plan, Revit result, snapshot, and diff.

### Phase 8 — walkthrough readiness

Scope:

- run the focused 2025 suite from a fresh process;
- start/restart only `ff-family-model-r25`, open the supported generated families sequentially, flex the agreed states, and capture final images/state;
- stop the exact sandbox without saving unrelated documents.

Exit gate: the checked-in profiles and tests are green, artifacts are linked from the family reports, and the examples are ready for the user/agent visual-function walkthrough.

### Phase 9 — v1.1 authoring and evidence convergence (complete)

Scope:

- register `FamilyModel` as a first-class settings root without renaming legacy FF command roots;
- route the Family Model UI and chat plugin through `settings.document.open/validate/save`, including version-token
  conflicts and disk persistence;
- route Family Model semantic diagnostics through `settings.document.validate` and remove the dedicated validation op;
- add the minimum settings-type validator registry in `Pe.Revit.SettingsRuntime`, leaving root bindings structural;
- return the minimum resolved per-type/provenance evidence from `revit.detail.family-model`;
- make the specialized UI consume authored content plus evidence, group parameters by existing `propertiesGroup`, and
  follow the normative evaluator/conformance rules;
- add root renderer discovery only if the generic settings shell needs it; otherwise route by the known Family Model
  settings root and defer the metadata change.

Proof:

- the same checked-in `family.json` opens from disk, the Family Model UI, and Pea with one `SettingsDocumentId`;
- LSP/schema, settings validation, UI diagnostics, and build rejection agree on invalid structural/semantic examples;
- a chat edit saves through optimistic concurrency and is immediately visible to disk and UI readers;
- the GRD evidence projection exposes formula-resolved values for every tested type, allowing the UI to render opening
  planes and `2n - 1` vane counts without evaluating formulas;
- the dumb evaluator conformance vectors pass in C# and TypeScript.

Completion evidence:

- Pea created and edited the same disk-backed settings document exposed to the beta UI; human review staged,
  validated, and saved Pea's proposed Width through the generic route commands.
- The final save advanced the version token and returned authored and composed Width as the same `21in` value.
- Pea used that exact saved `rawContent` to build and open a real Revit 2025 family in the SDK-owned sandbox.
- `revit.detail.family-model` read the reopened RFA and returned exact Width evidence of `1' - 9"` (21 inches), with
  no unmodeled diagnostics. The user-owned RRD was not targeted.

Exit gate: disk, UI, Pea, and scripts use the same authored language and settings lifecycle; specialized UI behavior is
a replaceable projection, and no Family Foundry rule lives in TypeScript schema/UI metadata.

## Goal completion criteria

The v1 implementation goal is complete when:

1. the supported profiles, required dependency models, and educational walkthrough are checked in;
2. each profile passes black-box A → capture → B roundtrip tests without hidden metadata;
3. GRD vanes and room-facing direction plus the showcase flex matrix are proven structurally and visually, and the
   unsupported plumbing boundary is documented without invented authored syntax;
4. the supported contract passes the installed Revit-year matrix or reports explicit convention incompatibilities;
5. Manager, capture/replay, Pea/host contracts, and web preview consume the same model vocabulary;
6. no work remains that is required for the agreed examples or their walkthrough.

The v1.1 convergence goal is complete when Phase 9's exit gate and proof are satisfied. It does not require the larger
settings refactors listed below.

## Explicit non-goals

- Migrating existing OneDrive/Documents/Pe.Tools family profiles or `fam-*` pod content.
- Applying an FFManager geometry model onto an existing family with arbitrary geometry.
- Changing `OperationProcessor`/FamilyProcessor internals. If an example cannot be implemented through the existing
  operation seam, stop and rescope with the user rather than quietly widening this project.
- Retesting the bulk family-migration harness unless a shared change creates a concrete regression risk that cannot be covered by focused tests.
- Encoding unsupported roundtrip semantics in extensible storage, hidden parameters, `DataStorage`, or other metadata.
- Expanding room-calculation-point direction/offset authoring beyond `{ "enabled": true }`.
- Building a Revit formula parser for web preview in v1.
- Building a custom JSON language server for semantic diagnostics.
- Adding resolved values, provenance, confidence, or generated geometry to authored `family.json`.
- Adding type descriptions/default flags or type-conditional constituent existence without a checked-in family.
- Renaming or migrating every command-named settings module/root as part of Family Model convergence.
- Adding `symbolics` or `companions` before those sections exist in the portable C# contract and roundtrip proof. They
  remain future authored vocabulary, not silently accepted v1 JSON.
- Adding generalized geometry, placement, or preset knobs without a checked-in example that needs them.

## Open items

- Preset re-recognition on capture (deferred, see #8).
- Puck-angle → Connector-orientation coupling (Phase 5 experiment, see #7).
- Clearance-box as a Migrator generalized op: only if it can be expressed without per-family frame authoring.

## Larger settings refactors to revisit after Phase 9

These are credible architecture candidates, but none is required to complete the immediate Family Model spec:

- replace command-named settings modules (`CmdFFManager`, `CmdFFMigrator`, and siblings) with feature/workflow names
  and provide an explicit migration plan for existing disk paths;
- decide whether root-level renderer metadata belongs in generated JSON Schema, the settings root descriptor, or a
  separate capability descriptor after a second specialized settings editor exists;
- normalize validation issue phase/provenance/severity across all settings consumers rather than adding Family
  Model-only fields;
- reconcile `settings.document.save`'s intentional invalid-draft writes with Pea's current assumption that invalid
  writes are rejected, then document one product-wide save contract;
- replace dot-joined settings field addresses with JSON Pointer or another escaped path contract before settings keys
  containing periods or other path punctuation must be edited collaboratively;
- remove or redesign the unused `ValidateSettingsRequest`/`ValidationData` bridge DTOs once the internal semantic
  validation transport is selected;
- consider offline/cached schema delivery only after live `$schema` URLs cause a proven disconnected-authoring problem.
- decide whether headless `pea --prompt` should attach to the host agent-controller session or whether route workspaces
  need an explicit product-workspace authorization scope. Today host-owned chat threads can use the shared route state,
  while independently created headless runtime thread IDs are intentionally not authorized by that host workspace.
