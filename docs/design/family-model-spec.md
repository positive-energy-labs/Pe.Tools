# Family Model (`family.json`) — design spec

Status: implementation contract, Phase 0. Captures the design review + constraint digest of 2026-07-15.
Owner surfaces: FamilyFoundry (FF). Consumers: FFManager, FFMigrator, capture, replay, Pea, host operations, web preview.

## Outcome

One portable **Family Package** — `family.json` + recursive `dependencies/` + `resources/` + `proof/` — that:

- an MEP engineer or agent can write by hand with only schema/LSP help (boxes, cylinders, Connectors first);
- a web view can render with a dumb evaluator (params → arithmetic → plane intersection → face lookup), zero Revit semantics;
- a scanner can understand at a glance (what is it → knobs → shape → connections);
- rebuilds behaviorally-equivalent families across Revit years. ElementIds, byte identity, and Revit-generated artifacts (array groups, equality dims) are **evidence, never authored state**.

Pipeline: capture → model (+ ambiguity diagnostics) → validate/flex/web preview → compile → Revit apply → snapshot + structural diff + images. Snapshots/images are checkpoints, never a second source of truth.

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
- `pe-bath-shower.family.json` — plumbing fixture with cold/hot/drain Pipe Connectors, inline puck stubs, parameter associations, and an upward room calculation point that resolves the containing room.
- `pe-wc-urinal-bidet.family.json` — the corresponding WC/urinal/bidet fixture with the same composition and upward-room contract.
- `family-model-showcase.family.json` — one contrived educational family exercising every supported param-driven-solids primitive and Connector profile. A sibling `family-model-showcase.md` explains the sections progressively without duplicating the JSON into several near-identical profiles.
- `dependencies/` — portable nested vane/puck family models required by those profiles. Generated `.rfa` files and screenshots remain test artifacts, not checked-in sources of truth.

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

### Phase 5 — plumbing fixture composition

Scope:

- implement the minimal inline Connector-stub compiler over the portable puck dependency;
- implement/capture nested transforms, hosting, visibility, and parameter associations required by the plumbing fixtures;
- author Bath-Shower and WC-Urinal-Bidet profiles;
- run the puck-angle experiment. If the existing convention does not make the real Connector rotate, report that observable limitation; do not persist metadata or widen the public API merely to force symmetry.

Proof: flex the real type matrices and selected angle/visibility states; compare Pipe Connector origin, normal, classification, diameter, fixture units, nested puck appearance, and associations. Place each family in a test room and assert its +Z calculation point resolves that room.

Exit gate: both plumbing profiles roundtrip with empty `unmodeled` for their declared contracts and pass visual inspection in the same exact sandbox.

### Phase 6 — cross-year portability

Scope:

- rebuild all four canonical profiles and recursive dependencies from target-year templates in Revit 2023, 2024, 2025, and 2026;
- use the same semantic/runtime assertions, allowing only documented target-year representation differences;
- keep template/resource resolution explicit in artifacts.

Proof: the focused FreshRevitProcess roundtrip suite passes per installed year, or emits a precise compatibility limitation without changing the authored profile to encode a Revit-year workaround.

Exit gate: cross-year results are summarized in proof artifacts and no year relies on a newer-version `.rfa` dependency.

### Phase 7 — product surfaces and dumb web preview

Scope:

- expose the schema/model through Manager, capture/replay, Pea/host contracts, and the FF web plugin surface;
- render supported params, planes, frames, faces, solids, Connectors, arrays, symbolics, and companions directly from `family.json`;
- evaluate only the portable literal/ref/arithmetic subset. Unsupported Revit formulas and `unmodeled` facts render warnings, never guessed geometry.

Proof: the four canonical profiles hydrate in schema/forms, compile through the host surface, and render the same named constituents as the Revit proof artifacts.

Exit gate: a user can inspect a profile, preview it, build it, and follow the same names through plan, Revit result, snapshot, and diff.

### Phase 8 — walkthrough readiness

Scope:

- run the focused 2025 suite from a fresh process;
- start/restart only `ff-family-model-r25`, open the four generated families sequentially, flex the agreed states, and capture final images/state;
- stop the exact sandbox without saving unrelated documents.

Exit gate: the checked-in profiles and tests are green, artifacts are linked from the family reports, and the examples are ready for the user/agent visual-function walkthrough.

## Goal completion criteria

The implementation goal is complete when:

1. the four canonical profiles, required dependency models, and educational walkthrough are checked in;
2. each profile passes black-box A → capture → B roundtrip tests without hidden metadata;
3. GRD vanes and room-facing direction, both plumbing fixture Connector/puck/room behaviors, and the showcase flex matrix are proven structurally and visually;
4. the supported contract passes the installed Revit-year matrix or reports explicit convention incompatibilities;
5. Manager, capture/replay, Pea/host contracts, and web preview consume the same model vocabulary;
6. no work remains that is required for the agreed examples or their walkthrough.

## Explicit non-goals

- Migrating existing OneDrive/Documents/Pe.Tools family profiles or `fam-*` pod content.
- Applying an FFManager geometry model onto an existing family with arbitrary geometry.
- Changing `OperationProcessor`/FamilyProcessor internals. If an example cannot be implemented through the existing
  operation seam, stop and rescope with the user rather than quietly widening this project.
- Retesting the bulk family-migration harness unless a shared change creates a concrete regression risk that cannot be covered by focused tests.
- Encoding unsupported roundtrip semantics in extensible storage, hidden parameters, `DataStorage`, or other metadata.
- Expanding room-calculation-point direction/offset authoring beyond `{ "enabled": true }`.
- Building a Revit formula parser for web preview in v1.
- Adding generalized geometry, placement, or preset knobs without a checked-in example that needs them.

## Open items

- Preset re-recognition on capture (deferred, see #8).
- Puck-angle → Connector-orientation coupling (Phase 5 experiment, see #7).
- Clearance-box as a Migrator generalized op: only if it can be expressed without per-family frame authoring.
