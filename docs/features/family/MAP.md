# Family portability — live effort map (worktree family-portability-oracle)

Delete this file when the effort ends; verdicts fold into LEDGER.md.
Sanctioned autonomous session 2026-08-18 (kaitpw AFK): waves execute in ruling order; rulings
are re-openable. Anything needing kaitpw's opinion lands in "Needs kaitpw", not in code.

## Waves

- Wave 0 — oracle proof (fresh lane, R25): evaluator-vs-probe assertions + SVG gallery meet a
  real Revit. Status: DONE (4/4 green, gallery eyeballed; the one disagreement it found was a real
  convention gap — see wave 0.5 below).
- Wave 1 — frame tree + `rotation { about, by }`: schema, validator (pin lift), lowerer, capture,
  evaluator conventions C#+TS + conformance rows. Status: LANDED for contract, evaluator, capture
  and both conformance readers; LOWERING REFUSES (typed `unsupported-frame` diagnostics), so no
  rotated family can be built or proved against Revit yet.
- Wave 2 — `ExtrudedPolygon` solid kind. Status: LANDED for contract, evaluator, oracle and capture
  honesty; LOWERING REFUSES (`unsupported-solid-kind`), so no polygon family can be built yet.
- Wave 3 — `settings` closed key set + lookup tables into `family.json`. Status: LANDED end to end —
  contract, capture, apply, probe and fixtures. `lookup-tables-not-yet-modeled` is deleted.
- Wave 4 — `WallHosted`. Status: LANDED as far as Revit allows — template rows, placement mapping
  CONFIRMED live, root frame convention measured, fixture authored, geometry REFUSED. Wall-hosted
  solids need a one-sided depth span on the wall face that the legacy plan cannot author.

Gate per wave: compile all four years + deterministic contract tests + a fresh-rung roundtrip
suite green (`pe-revit test --project <P> --filter ...`), oracle assertions included. No wave weakens an existing assertion.

## Family review board — find-the-product round 1 (2026-08-19)

Route: `/family-review-proto?variant=a|b|c` (throwaway, sub-shape B). Dev server: Herdr session
`famui`, pane `w1:p1`, <http://localhost:3000/family-review-proto>.
ROUND 1 CLOSED 2026-08-19 — verdicts in `LEDGER.md` (Decided + Tried & rejected): C wins, A
demoted to an expand-sidebar concept, B retired as the wrong model, plus the materializations
model and the source-of-truth/targeting law. Round 2 frontier below.

## Family review board — round 2 frontier (2026-08-19)

Laws from round 1 bind every variant: the surface is "what jsons do I have / where do I
materialize / how healthy is a prior materialization", and every view states what it reads from
and sends to — no implied sync.

1. LANDED 2026-08-19 — variant A folded in as an EXPAND SIDEBAR on the C board (six 80px SVGs +
   constituent breakdown incl. nested/arrays, read off the authored document so it works on the
   refused wall-sink). `?variant=` and B's code deleted. The build report died with the
   worktree; its decisions are inlined here and in the round-2 gate.
2. LANDED 2026-08-19 — `proto/compact-table.tsx`: `CompactTable`/`CompactColumn`/`CompactEdit`,
   the compact mode of the table language (vs `MasterTable` full mode). Edits go through
   `/family`'s own `NavStateCell` — same caret, refusal, staging behavior — with staging rules as
   pure functions in `family-review/model.ts`, pinned in `board.test.ts` (12 tests). Writable =
   `settings` keys only; every other row renders LOCKED with a `capReason`. New gate questions it
   raised (where an edit goes; whether parameter rows should join the writable surface) are in the
   round-2 gate below.
3. LANDED 2026-08-19 — three editing-paradigm prototypes at `/family-editor-proto?paradigm=a|b|c`
   (`family-review/proto-editor/`), all editing the real showcase fixture in memory with a live
   pointer-diff state panel ("what you would SEND", per the no-sync law). Build log + per-paradigm
   findings inlined below (full report died with the worktree). Findings that outlive the prototypes:
   - The relation graph (`familyGraph`, ~200 lines) is the SUBSTRATE, not a paradigm — all three
     surfaces needed it; whichever surface wins, it is the thing to promote.
   - The reverse direction ("what is defined off this") is the product; the forward direction is
     readable from the JSON. Re-anchor-with-stated-blast-radius is the operation a generated form
     structurally cannot offer — the proof the form-generation rejection was right.
   - Scoped legal-token pickers (`RefToken`) delete the "what may go in this slot" difficulty in
     any layout; the most transferable thing built. `components/sentence.tsx` did NOT fit (it is
     a targeting surface, slots module-private); the generic token is the missing app-wide piece.
   - A and B fail in opposite directions off the same missing fact: B shows the consequence and
     hides the dependency, A the reverse. A trustworthy drawing (TS frame resolver, round-1 gate
     item 2) is a PRECONDITION for drawing-as-form, not an improvement.
   - Builder recommendation (unasked): one page — C's sentences for authoring, A's reverse-
     dependency panel for editing, B's dimension-line click as entry once the drawing is honest;
     `familyGraph` makes the composition cheap.
4. NOW BLOCKING (was low priority) — SVG fidelity / the TS frame resolver. Round 3 proved the
   composed page makes the lying drawing WORSE: the sidebar shows you repointing a solid's frame
   while the picture does not move. Port the C# frame resolver to TypeScript or refuse to draw,
   before promotion.

## Round 3 — the composed page, LANDED 2026-08-19 (commit fd5ef4a)

`/family-editor-proto?paradigm=d` — hybrid parameter grid (skeleton-from-table,
vocabulary-from-sentence, cross-type columns, sort/filter/arrow-nav), triptych + provenance
sidebar, aligned sentence grids, synced `JsonView`-backed json pane with pointer↔range
highlighting, edits-land-in-json chrome with mock `write`/`discard`. Board sidebar now overlays
right (no rail reflow). 232/232 tests. Full findings + the 8 kaitpw items:
the report died with the worktree — key ruling material:
- Hybrid degree is a function of ROW COUNT, not taste: connective words stay in rows while the
  group is small, move to the header when it is not (parameters: header; solids: rows).
- The JSON pointer is the universal join (diff, highlight, caret→row are one mechanism).
- Known layout defect at 1276px: horizontal overflow (main + 420px json + 320px pending-write);
  fix at promotion.
- Pre-ship bugs named in code: JSON pointers unescaped both sides (RFC 6901 — `Center
  (Front/Back)` collides), `JsonEditor` needs a `decorations` prop for editable-pane highlight.

Merge intent: the other family worktree (json editor + form generator infra) may merge into this
one so later rounds can use that infra; its prototypes die at the merge.

### The round-2 gate — kaitpw rules these

1. **Where an edit goes** (sharper than the verdict question, now stated on the surface): write
   back to the `family.json` on disk (board needs an addressable json — the fixture is not one),
   or stage for the NEXT materialization (needs a materialization queue that does not exist).
   Both respect the no-sync law; the pick decides reader-with-annotations vs small editor.
2. **Where a verdict goes** — a human fact about (family, type, RUN); nothing in the repo holds
   that tuple.
3. Whether `settings`-only writability is the answer, or family-parameter rows (a `"parameter"`
   `RowKind` exists unused; ~20 lines) should join and roughly triple the writable surface.
4. Rail expand control is a text `open`/`hide` button (no icon rails); disclosure caret is a swap
   if wanted.
5. RULED 2026-08-19 (see LEDGER Decided): sentence interface wins for editing; table-like is the
   parameter paradigm; main lane = parameter table → triptych + sidebar → everything-else table
   ("C with B in the middle"); legal-options law is permanent; A's provenance clicking persists
   in spirit. Still open from the ruling: sentence-row column alignment, cross-type parameter
   editing in sentence form, and whether `RefToken` moves to `components/lang` with
   `sentence.tsx` rebuilt on it.
6. OPEN, deliberately deferred: the left sidebar's role — (1) profiles navigator with targeting
   handled by sentence targeting, vs (2) profile selection/targeting with no top-level jump-to
   nav. A cross-product methodology question (when sidebar, when sentence targeting) to compare
   across all emerging products later; cited in the design-system ledger.

The question: when the human eyeball is the last oracle on whether a portable `family.json` built
the family we meant, what is the board?

- Variant A · SHEET — a card per family x type, predicted triptych BESIDE actual triptych, row
  table underneath. The `/runs` takeoff run-browser lineage (two-column zone cards, stat table with
  A / B / delta), read off `room-solve-tuning`'s `src/runs/browser.tsx` at commit ead263a.
- Variant B · TABLE — one `MasterTable` over EVERY checkable claim in every family; the drawing is
  a mode of the table, docked below it. Tests SURFACE-PHILOSOPHY section 0 ("the cross-cutting view
  is the product") on a domain where the picture, not the number, carries the verdict. Spends the
  `verdict:` clause and the R3 gutter marker.
- Variant C · OVERLAY — refuses side by side. ONE triptych per family, the prediction drawn as a
  thin ghost UNDER the actual ink in one frame; the row table shrinks to what is not "agrees".
  A and B make the reader register two pictures in their head; C does the registration and pays by
  losing the ability to look at either side alone. That trade is the round's real question.

### What the round found before anyone judged it

- **The board's content is NOT the delta.** Every predicted solid already agrees with Revit to
  1e-6 — `FamilyModelEvaluatorOracleAssert` asserts exactly that and the suite is green. What the
  board actually carries is the UNASSERTED residue, and it needed a six-word vocabulary to say so:
  `agrees` / `differs` / `authored only` / `Revit only` / `refused` / `no reading`.
- **`PE GRD Supply` has no oracle at all.** It authors zero solids: planes plus a nested vane plus
  a `CenteredLinear` array. The oracle predicts nothing, the one extrusion Revit built is the
  face-based template's host placeholder (`Revit only`), and the array that makes fifteen vanes has
  NO probe reading (`no reading`). The eyeball is the ONLY oracle for the anchor family. Pinned in
  `family-review/board.test.ts`.
- **`PE Family Model Showcase` builds four extrusions nobody authored** — connector stubs are
  extrusions too. `Revit only` is a first-class row, not noise to filter.
- **An omitted `settings` key is not agreement.** Capture emits a key only when it differs from a
  stated default, so a silent document plus a template value must never read as `agrees`.

### Prep slice, landed

- `ProbeJsonDump` writes `<family>/<type>.probe.json` beside every `ProbeSvgGallery` SVG, carrying
  the runtime probe AND `FamilyModelEvaluatorOracle.Predict`'s own prediction (a prediction the
  oracle refuses becomes a `refusal` string — board content, not an error). Newtonsoft, because
  analyzer PE1011 bans `System.Text.Json` in a Revit-hosted project.
- Fresh lane, twice, R25, `--filter "FullyQualifiedName~FamilyModelRoundtripTests"`: 6 passed /
  0 failed both times (`.artifacts/tmp/board-fresh.json` proved the wiring, `board-fresh2.json`
  carries the prediction). Artifacts under `.artifacts/runs/family-oracle-20260819-board/`.
- Web fixture `family-review/proto/fixtures.ts` is generated from those artifacts plus the four
  checked-in `family.json` fixtures. `pe-wall-sink` carries the lowerer's `unsupported-placement-
  geometry` text verbatim and no probe, because it is never built.
- `FamilyModel` (web) grew the `settings` and `lookupTables` sections the C# contract has carried
  since wave 3; the typed mirror had lagged.
- Gates (re-proven 2026-08-19 after the guard fix): `vp check` clean (formatter noise on 204
  pre-existing files left alone); `vp test` 201 passed / 0 failed. The `design-guard` walk now
  EXEMPTS prototype code (any `proto/` dir and `routes/*-proto.tsx`) — the ratchets could not
  tell a prototype from a shipping route, and the promotion pass out of `proto/` is what re-arms
  them. `variants.tsx`/`views.tsx` moved into `family-review/proto/` to match. The guard suite
  had also failed to PARSE (a `**/proto/**` glob inside its own block comment ended the comment
  early); reworded.
- **Paint proven.** All three variants eyeballed in a browser on the fixture: A shows predicted
  beside actual triptychs with claim tables and verdict buttons, the wall-sink card renders the
  typed refusal verbatim in place of a drawing; B shows the claims MasterTable with filters; C
  shows the ghost-under-ink overlay. `family-review/board.test.ts` (5 passed) pins the pairing.

### The round-1 gate — kaitpw rules these

1. Which variant, or which parts of which. A and B versus C is a disagreement about whether the
   board should register the two sides for you.
2. **Where the predicted side comes from.** It is the C# oracle's prediction, shipped in the run
   artifact, because the web's own `buildSheet` is a v1 approximation that centres every solid on
   the family centre planes and ignores `frame` entirely — it would draw a confident lie about any
   framed or rotated family. The price: the board cannot open a `family.json` the user drops on it
   without a Revit run first. Alternative is porting the oracle's frame resolver to TypeScript.
3. **Where a verdict is written.** Mocked in memory this round. A verdict is a human fact about a
   family at a run, and nothing in the repo has a home for one.
4. Whether this is a route at all, or a mode of `/family` (one family, drill-in) or `/families`.
5. Whether `no reading` earns its place, or arrays and nested families should simply not list.

Three of the "Needs kaitpw" items below are review-UI questions this round can now show rather
than describe: the front = -Y versus Front-face = +Y sign duality (visible in every plan view), the
non-bindable geometry inspector, and how a typed refusal renders (variant A and C both draw it).

## Needs kaitpw

(collected during the session — each line is a decision, not a status)

- Family plane `Out` is −Y while a solid's `Front` FACE is +Y — one document, two Y sign languages.
  Revit proved the plane side (`opening.Front` lands at Y = −1.25 ft, because the stock
  `Center (Front/Back)` normal points at the front, which Revit puts at −Y). Options: (a) keep both
  and document, as landed; (b) flip `ResolvePrismFace` so Front = −Y everywhere — costs the
  `ValidateConnectorFrameDirection` table and re-authoring the showcase `return-air` frame; (c) make
  the lowerer compensate for the template plane normal so `Out` from CenterFB means +Y — portable,
  but then the authored document and the Revit plane normal disagree on which side is "out".
- Wall-hosted SOLIDS are blocked on the legacy plan, and this is the wave-4 finding: a stock
  `Plumbing Fixture wall based` template exposes exactly three named reference planes —
  `Center (Left/Right)`, `Back` (the wall face) and `Reference Plane` — and has NO
  `Center (Front/Back)`, which is the plane the legacy plan centres every solid's depth on. Before this
  wave that produced a family with no solids and a SUCCESSFUL apply, because `CreateSymmetricDimensions`
  logs "Center not found" and nothing escalates. Options: (a) keep the typed refusal, as landed;
  (b) teach `AuthoredPrismSpec.Width` a one-sided span anchored on a named plane, and teach capture to
  read it back (lowerer + compiler + capture, roughly the size of wave 1); (c) make wall-hosted families
  carry their own frame whose origin sits on the wall face, once frames can place solids at all.
- Wall-based template choice was made autonomously from the machine census: `Plumbing Fixture wall
  based.rft` for Plumbing Fixtures and `Generic Model wall based.rft` for Generic Models, both present
  in `C:\ProgramData\Autodesk\RVT 2025\Family Templates\English-Imperial\` alongside 18 other
  wall-based templates (Casework, Lighting Fixture, Mechanical Equipment, Specialty Equipment and
  more). The convention follows the existing `InferTemplate` table: one stock template per category,
  named `<Category> wall based`. Options: (a) keep the per-category rows, as landed; (b) route every
  wall-hosted category through `Generic Model wall based` and set the category afterwards; (c) let the
  authored document name any installed template and drop inference for wall-hosted families.
- Revit 2026 REMOVED `BuiltInParameter.OMNICLASS_CODE` and `OMNICLASS_DESCRIPTION` (binary-verified in
  the 2026.4.10 API assembly; the other five settings parameters are present in both 2023 and 2026). Its
  replacement is the `ClassificationEntry` / `ClassificationEntries` model — several systems, several
  entries — which is a different shape, not a renamed parameter. Landed: R23–R25 read and write the
  parameter, R26 refuses an authored `omniClass` with that reason and captures none. Options: (a) leave
  the year split, as landed; (b) model classification entries portably and map OmniClass onto one entry
  on the older years; (c) drop `omniClass` from the key set and let the OmniClass number ride as an
  ordinary family parameter.
- `settings.alwaysVertical` and `settings.partType` have NO portable default, so capture emits whatever
  the document holds while `shared`, `cutWithVoidsWhenLoaded` and `omniClass` are emitted only when they
  differ from a stated default. Pinning defaults for the first two needs a per-template, per-year survey
  nobody has run. Options: (a) keep the asymmetry, as landed; (b) run the survey and pin them; (c) drop
  the omission rule and always emit all five.
- The ruling listed the room-calculation-point OFFSET among the `settings` keys; it landed as
  `roomCalculationPoint.offset` instead, because that section already owns the point and the offset is an
  element position rather than a Revit parameter — every `settings` key is exactly one named parameter.
  Re-openable: moving it costs one rename.
- `settings.partType` is unproven against a live Revit: Generic Models carry no
  `FAMILY_CONTENT_PART_TYPE` parameter, so the roundtrip fixtures cannot exercise it. Proving it needs an
  MEP-category fixture (the ERV/AHU anchor family would do it).
- The legacy plan cannot build an `ExtrudedPolygon` either: `AuthoredPrismSpec` is two symmetric span
  pairs (a rectangle) and `AuthoredCylinderSpec` is a centre plus a diameter (a circle); neither can
  carry a ring of sketch lines, and there is no third sketch spec. Options: (a) leave the typed
  `unsupported-solid-kind` refusal, as landed; (b) add an `AuthoredPolygonSpec` — a list of points, each
  a length driver, plus the sketch-line and constraint plumbing in
  `AuthoredParamDrivenSolidsCompiler`, which is where the real cost sits; (c) build polygons through a
  new apply path and leave the legacy plan to rectangles and circles forever. Note (b) and the frame
  work below want the same new plan surface, so they are cheaper together than apart.
- The legacy ParamDrivenSolids plan cannot build a rotated frame or a solid off `frame:family`: an
  extrusion sketch is authored as spans about the fixed `@CenterLR`/`@CenterFB` anchors on
  `@Bottom`, and a connector frame is two axis TOKENS (`FrameNormal`/`FrameUp`). There is nowhere to
  put a turned sketch plane or a moved sketch origin. Options: (a) leave the typed refusal, so the
  clause is contract + evaluator + capture only (as landed); (b) add a rotated/relocated sketch
  plane to the legacy plan (real work in `AuthoredParamDrivenSolidsCompiler` + `RefPlaneDimCreator`);
  (c) build frames' solids through a new apply path and retire the legacy plan for solids.
- `frame:family` still means "family origin, unrotated". A frame tree over rotated frames therefore
  has no observable proof until a rotated solid can be BUILT — the wave-1 rotation math is proved by
  conformance vectors in three languages, never yet against Revit.

## Wave log

- 2026-08-18 — wave 0 launched (`test fresh --filter "Name~Roundtrip"`, R25).
- 2026-08-18 — wave 0 run 1: filter `Name~Roundtrip` is case-sensitive and MISSED all four
  `FamilyModelRoundtripTests` (their names spell "roundtrip" lowercase); it caught 16 other
  tests, 11 passed / 5 failed. The 5 failures do not intersect this worktree's diff surface:
  `Profile_fixtures_validate_roundtrip_and_compile_param_driven_solids` × 2 ("JSON validation
  failed" on `family-model-evaluator.conformance.json` and `real-mech-equip-base-mapping.json` —
  untouched files), `FF_manager_roundtrip_can_repeat_on_staged_generic_family_document`
  ("Method not found: Pe.App.Benchmarks…" — assembly mismatch), and
  `LocalDiskJsonFile_roundtrips_parameter_snapshot_forge_type_labels` (PropertiesGroup/DataType
  string asserts). Suspected pre-existing at main tip 723ee73 — baseline confirmation owed.
  Run 2 relaunched with `FullyQualifiedName~FamilyModelRoundtripTests`.

- 2026-08-18 — wave 0.5 (sign flip): DIAGNOSED as an oracle bug, not a Revit bug. The conventions
  said nothing about which way `Out` travels from a family center plane, so the oracle guessed +Y
  for all three. Revit is ground truth here: `Out` from `plane:family.CenterFB` lands at −Y, which
  is Revit's own front side. `FamilyModelEvaluatorConventions.ResolveFamilyPlane` now states the
  table (`CenterLR` +X, `CenterFB` −Y, `Bottom` +Z) with the live proof in its doc-comment; the
  oracle reads it instead of restating it, the plane assertion compares plane-to-plane (normal
  orientation + distance) instead of axis-plus-coordinate, and the web projection
  (`family/family-model.ts`) routes its datum sign through the same function. Conformance fixture
  gained a `familyPlanes` block, read by the C# and TypeScript tests. Sign choice recorded in
  "Needs kaitpw".
- 2026-08-18 — working filter for all four roundtrip tests:
  `--filter "FullyQualifiedName~FamilyModelRoundtripTests"` WITHOUT `--no-build`
  (`"total": 4`). The earlier `total: 1` run carried `"NoBuild": true`; a stale test assembly is
  what discovered one test, not the filter. `Name~Roundtrip` is case-sensitive and matches none of
  the four.
- 2026-08-18 — baseline honesty on the five run-1 failures: CONFIRMED pre-existing, by inspection,
  not by re-reading the artifact (`.artifacts/tmp/oracle-fresh-run.json` was overwritten by a later
  4-test run and no longer holds them). `Profile_fixtures_validate_roundtrip_and_compile_param_driven_solids`
  globs EVERY `*.json` in `Fixtures/Profiles` (`ParamDrivenSolidsJsonContractTests.GetProfileFixtureNames`)
  and validates each as an `FFManagerProfile`, so the two non-profile files there
  (`family-model-evaluator.conformance.json`, `real-mech-equip-base-mapping.json`) fail on presence,
  not on content — this worktree only added keys to a file that already failed. The other two name a
  missing `Pe.App.Benchmarks` method and Forge type labels, neither of which this diff touches. Not
  fixed: out of scope.
- 2026-08-18 — wave 1 (frame tree + rotation) LANDED as contract + evaluator + capture; lowering
  REFUSES. Validator: solids and nested families accept any declared frame, `rotation { about, by }`
  is schema + strict-validated (one axis token or `normal`/`up`; `param:` or an angle literal), and
  one reference-graph walk rejects cycles across frames, planes, solids and nested families with the
  loop named (`reference-cycle`). Conventions grew the algebra: vectors, a frame transform, the
  right-handed basis from `normal`/`up`, Rodrigues rotation, radians-to-degrees for `param:` drivers,
  and three-plane intersection for frame origins. The oracle walks the frame tree through those
  functions only. Lowerer emits typed `unsupported-frame` refusals with the reason (see "Needs
  kaitpw"); capture names the loss `frame-rotation-not-observable` when the document holds a turned
  sketch plane. No fixture was rotated, because nothing can build one yet.
- 2026-08-18 — wave 1 gates: (1) `dotnet build Pe.Revit.Tests.csproj` for `Debug.R23/R24/R25/R26.Tests`
  → 0 errors each. (2) `dotnet test Pe.Shared.Tests` → 119 passed / 0 failed, including 12 new
  frame-tree and rotation tests. (3) fresh lane
  `test fresh --configuration Debug.R25.Tests --filter "FullyQualifiedName~FamilyModelRoundtripTests"`
  → `"outcome": "passed"`, 4 passed / 0 failed / total 4 (`.artifacts/tmp/wave1-fresh.json`), gallery
  under `.artifacts/runs/family-oracle-20260818/`. TypeScript: 71 web tests pass, the conformance
  test reading the new `familyPlanes` / `frameOrigin` / `frameTransforms` rows included.
- 2026-08-18 — gallery eyeball (`PE GRD Supply A / Fifteen Vanes.svg`): the three views agree. Plan
  puts `opening.Front` 42.6 px BELOW the centre and `opening.Back` the same distance above it
  (2 ft scale bar = 68.2 px, so ±1.25 ft, and Front on −Y as ruled); the Right view shows the same
  two planes as vertical lines on the matching sides; the Front view omits them, which is correct
  for a plane seen edge-on. The only solid is the face-based template's 8×8×1 host placeholder,
  square in plan and a 1 ft slab below the reference level in both elevations.
- 2026-08-18 — second fresh pass, `--filter "FullyQualifiedName~FamilyModelLowererTests"` → 7 passed
  / 0 failed / total 7 (`.artifacts/tmp/wave1-lowerer.json`). It carries the C# conformance reader,
  the lowering seam, and one new deterministic oracle test: a prism on a frame that stands on
  another prism's top face and turns a quarter turn about its own normal predicts min
  `[-0.5, -1, 1]` / max `[0.5, 1, 1.5]`. That is the only proof the frame-tree walk has; a rotated
  family still cannot be BUILT, so Revit has never seen one.
- 2026-08-18 — wave 2 (`ExtrudedPolygon`) LANDED as contract + evaluator + oracle + capture honesty;
  lowering REFUSES. Schema: `ExtrudedPolygon` / `VoidExtrudedPolygon` plus `profile`, an ordered ring
  of `{x, y}` points in the frame's XY plane, each coordinate a portable length or a `param:`
  reference. Validation demands at least three points, refuses a last point that repeats the first
  (the ring closes implicitly), refuses width/depth/diameter on a polygon and `profile` on anything
  else, and deliberately does NOT check self-intersection — Revit judges whether a sketch is valid,
  and a second opinion in the contract could only disagree with the one that matters.
- 2026-08-18 — wave 2 face ruling: a polygon enumerates `Top`, `Bottom` and one `Edge<N>` per segment
  (edge N joins point N to point N+1, the last closing the ring), but `Edge<N>` is NOT a valid
  reference target — it joins `Side` in the refused set. An edge's only identity is its authored
  ordinal: Revit gives a sketch-derived face no stable name, so capture would have to guess which
  planar face is edge 3, and inserting one profile point renumbers every edge after it. `Top` and
  `Bottom` stay referenceable because there are exactly two of them whatever the profile does. The
  rule lives in `FamilyModelValidator.IsReferenceableFace`, beside the enumeration it narrows.
- 2026-08-18 — wave 2 evaluator: `ResolvePolygonBounds` (extremes of the resolved points, bottom to
  height) plus `ResolveLengthFeet` — the length law moved OUT of the test-side oracle into the shared
  conventions, so the C# contract tests, the oracle and the TypeScript mirror now resolve `9in`,
  `param:Reach` and `1/2ft` through one implementation instead of three. Conformance fixture gained a
  `polygons` block (a literal L-profile and a param-driven point with mixed units), read by both test
  suites. The oracle predicts a polygon's world bounds from its own vertices at both ends of the
  extrusion, which is exact on a turned frame too.
- 2026-08-18 — wave 2 honesty seams: the lowerer refuses the kind with `unsupported-solid-kind`
  naming what the legacy plan has instead (a rectangle from span pairs, a circle from centre plus
  diameter, no ring of sketch lines); capture names a sketch that is neither a four-line rectangle
  nor a circle `extrusion-profile-not-portable` instead of leaving it inside the count mismatch; the
  oracle's probe assertion says out loud that the runtime probe reads rectangular and round
  extrusions only, so a predicted polygon cannot be checked against Revit yet. The web anatomy
  drawing needed no change: a solid with no width/depth/height already lands in its "partial solids"
  list and is described in words rather than drawn at a guess.
- 2026-08-18 — wave 2 gates: (1) four-year compile `Debug.R23/R24/R25/R26.Tests` → 0 errors each,
  re-run after the last test landed. (2) `dotnet test Pe.Shared.Tests` → 123 passed / 0 failed
  (16 in the frame-tree + polygon fixture). (3) fresh lane
  `--filter "FullyQualifiedName~FamilyModelRoundtripTests"` → `"outcome": "passed"`, 4 passed /
  0 failed / total 4 (`.artifacts/tmp/wave2-fresh.json`) — no fixture was changed, so this is the
  regression proof, and it also proves the new capture check does not false-fire on the existing
  rectangle and circle sketches. (4) TypeScript: 71 web tests pass, including the new `polygons`
  conformance rows.
- 2026-08-18 — wave 2 second fresh pass, `--filter "FullyQualifiedName~FamilyModelLowererTests"` →
  8 passed / 0 failed / total 8 (`.artifacts/tmp/wave2-lowerer.json`). The new one predicts an
  L-shaped polygon with a param-driven vertex (min `[-1, 0, 0]`, max `[0.75, 2, 0.5]`) and then
  asserts the SAME document lowers to nothing but one `unsupported-solid-kind` diagnostic — the
  portable contract reaching past the legacy plan, pinned as a test rather than as prose.
- 2026-08-18 — wave 3 (`settings` + lookup tables) LANDED END TO END, the first wave whose apply path
  actually writes what it models. `settings` is five keys, each one named Revit parameter on the family
  element: `alwaysVertical` (`FAMILY_ALWAYS_VERTICAL`), `shared` (`FAMILY_SHARED`),
  `cutWithVoidsWhenLoaded` (`FAMILY_ALLOW_CUT_WITH_VOIDS`), `partType` (`FAMILY_CONTENT_PART_TYPE`, a
  `FamilyPartType` enum mirroring `Autodesk.Revit.DB.PartType` by name) and `omniClass`
  (`OMNICLASS_CODE`). Grounding was reflection plus a binary check of the 2023 and 2026 API assemblies,
  not memory — which is how the Revit 2026 removal below was found before a build did.
- 2026-08-18 — wave 3 lookup tables: `lookupTables` is `{ name: { csv } }`, carrying Revit's own CSV
  because that CSV is what `FamilySizeTableManager` imports and exports, and a second column grammar
  would be a second place to get the `Name##type##unit` header wrong. `LookupTableCsvCodec` stays the ONE
  codec: capture re-encodes what `LookupTableSnapshotCollector` decoded, lowering decodes into the
  existing `SetLookupTables` operation, and a CSV Revit could not read fails at lowering as a typed
  `invalid-lookup-table` diagnostic naming the table. The `lookup-tables-not-yet-modeled` unmodeled
  emission is DELETED, replaced by real capture.
- 2026-08-18 — wave 3 room-calculation point: `AddRoomDingler`'s hard-coded one-foot offset became an
  authored `roomCalculationPoint.offset` (a length LITERAL — an element position cannot follow a
  parameter, so a `param:` offset would look live and be frozen). Capture emits it only when it is not
  one foot, and the "is this the PE convention" check now tests the DIRECTION the point travels rather
  than a fixed distance, which is what the convention actually fixes.
- 2026-08-18 — wave 3 proof discipline: the first strengthened run FAILED (3/4) because the new
  authored-vs-Revit assertion landed in the minimal-box test instead of the showcase — both tests share
  the anchor line it was inserted after. That failure is the reason the assertion exists: A ≡ B alone
  cannot tell an applied setting from one that never applied, since both documents would then hold the
  template value. Corrected, the run is 4/4 with Revit asserted to hold `alwaysVertical=false`,
  `cutWithVoidsWhenLoaded=true`, a 2 ft calculation-point offset, the `FF Minimal Sizes` table, and the
  showcase's OmniClass code.
- 2026-08-18 — wave 3 gates: (1) four-year compile `Debug.R23/R24/R25/R26.Tests` → 0 errors each — the
  R26 build is what proved `OMNICLASS_CODE` gone. (2) `dotnet test Pe.Shared.Tests` → 132 passed /
  0 failed, including 9 new settings and lookup-table contract tests. (3) fresh lane
  `--filter "FullyQualifiedName~FamilyModelRoundtripTests"` → 4 passed / 0 failed / total 4
  (`.artifacts/tmp/wave3-fresh.json`), WITH both fixtures extended, so this run is the proof rather than
  a regression formality. (4) TypeScript: 71 web tests pass; the preview gained "Settings" and "Lookup
  tables" constituent groups so a `family.json` cannot carry them invisibly.
- 2026-08-18 — wave 3 evidence residual: `FamilyModelEvidenceContracts` stays untouched. It projects
  per-type PARAMETER resolution (value, source, provenance); family-global switches and embedded tables
  have no per-type resolution to report, so adding them would widen a record used elsewhere for no
  derivable fact. Skipped deliberately, not forgotten.

- 2026-08-19 — wave 4 (`WallHosted`) census first, per the ruling: the machine carries 20 wall-based
  templates under `RVT 2025/Family Templates/English-Imperial/`, including `Generic Model wall
  based.rft` and `Plumbing Fixture wall based.rft`, so nothing was synthesized. `InferTemplate` gained
  two rows — (WallHosted, Plumbing Fixtures) → `Plumbing Fixture wall based`, (WallHosted, Generic
  Models) → `Generic Model wall based` — following the existing one-template-per-category convention.
- 2026-08-19 — wave 4 placement mapping CONFIRMED against Revit, not assumed: a document created from
  the wall template reports `FamilyPlacementType.OneLevelBasedHosted`, so `GetPlacement`'s enum-only
  claim was right, and a test now asserts it instead of a comment claiming it.
- 2026-08-19 — wave 4 root frame convention, MEASURED: X is centred on `Center (Left/Right)` and Z rises
  from `Reference Plane` exactly as in the other templates, but depth is anchored on the wall FACE
  (`Back`) and runs out of the wall (−Y) — a wall-hosted family is not centred in the wall's thickness.
  My pre-build assumption said the opposite (that wall-hosted solids land on unhosted coordinates); the
  build disproved it and the conventions doc-comment now carries the measured truth plus the reason
  geometry is refused. This is the wave-0.5 lesson again: the template is the authority, memory is not.
- 2026-08-19 — wave 4 landed: fixture `pe-wall-sink.family.json` (basin prism + bowl void + Sanitary
  pipe connector, inside the buildable vocabulary), a typed `unsupported-placement-geometry` refusal in
  the lowerer naming the missing plane, a live census test pinning the template's three planes and the
  placement, and a refusal test pinning the gap. Two contract tests in `Pe.Shared.Tests` cover the
  placement at the authored boundary, including that an unknown placement is refused there.
- 2026-08-19 — wave 4 gates: (1) four-year compile `Debug.R23/R24/R25/R26.Tests` → 0 errors each.
  (2) `dotnet test Pe.Shared.Tests` → 134 passed / 0 failed. (3) fresh lane
  `--filter "FullyQualifiedName~FamilyModelRoundtripTests"` → 6 passed / 0 failed / total 6
  (`.artifacts/tmp/wave4-fresh.json`); the intermediate runs were 4/5 and 4/6, and both failures were
  the finding above rather than flakiness. (4) Gallery: `.artifacts/runs/family-oracle-20260819/`
  holds 16 SVGs for the four BUILDABLE families. There is NO wall-sink SVG and there cannot be one —
  the family is never built. Eyeballed `FF Minimal Box A / Default` instead: plan shows the 12×8 in box
  centred on both centre planes with `body.front` below centre and `body.back` above it (the −Y front
  convention holding), and the elevations show it sitting on `Reference Plane` and rising 6 in.

