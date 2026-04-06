# Pe.Revit.Tests — Harness / Performance / Declarative-State PRD

## Intent

Use `Pe.Revit.Tests` as the main Revit-backed proving ground for a broader codebase direction:

> Treat Revit elements and document state less like opaque live API objects and more like portable, declarative data. Snapshot the meaningful state of families, parameters, geometry intent, and relevant document context into stable models that can be serialized, tested, transformed, diffed, and replayed. A settings/profile file should be able to describe intended family state directly, and rerunning the same profile should drive the family back to the same result with high consistency.

This is not just a testing goal. It is an architectural direction for FF, parameter work, and future Revit abstractions.

---

## Primary outcomes

1. **Performance proof lane**
   - Repeatable Revit-backed performance demos across:
     - machines
     - Revit versions
     - document states
     - family type counts
     - family element counts
     - levels of parameter/element interdependence
   - Output should stay compact, compare open/action/close separately, and be stable enough for regression tracking.

2. **Harness-first testing shape**
   - Prefer a few strong reusable harnesses over a huge brittle suite.
   - Tests should prove behavior through normalized state capture, not ad hoc assertions against live API objects.
   - Build reusable family-doc harnesses first; only add broad end-to-end tests after seams stabilize.

3. **Portable-state / snapshot confidence**
   - Prove that snapshot -> authored settings/profile -> replay can roundtrip meaningful family state.
   - Encode which parts of family/document state are intentionally captured, ignored, lossy, or not yet portable.

---

## Current user priorities to preserve

### A. Performance-first

Most important near-term axis: performance tests and harness infrastructure, not broad coverage for its own sake.

### B. Small number of beefy examples

Second priority: establish a good harness shape with a few heavy examples that exercise real runtime seams.

### C. Avoid overcommitting while the design is in flux

Do **not** build a giant suite prematurely. Prefer additive slices that:

- prove a seam is worth stabilizing
- expose scaling behavior
- produce reusable infra for later tests

---

## Test strategy hierarchy

### Tier 1 — harness / probe / state-model tests

Purpose: make live Revit state observable in normalized forms.

Focus areas:

- family-doc setup helpers
- parameter state capture
- type-matrix evaluators
- normalized probes for geometry/planes/dims/connectors/associations
- dependency graph capture helpers

These are the foundation. They should make later tests shorter and more legible.

### Tier 2 — focused behavioral tests

Purpose: prove exact Revit/API/runtime semantics at one seam.

Examples:

- parameter coercion / parsing
- association APIs
- snapshot projection rules
- family param replay rules
- dependency discovery behavior
- parameter definition resolution on family instances
  - (codify the merge between project bindings, internalDefinition, etc.)

### Tier 3 — constrained end-to-end proofs

Purpose: verify that authored profile execution produces expected normalized post-state.

Examples:

- FF roundtrip fixtures
- snapshot replay fixtures
- parameter-driven solids replay

Keep these relatively thin and assertion-focused.

---

## Performance roadmap

### 1. Existing benchmark lane direction

Keep `RevitBenchmarkHarness` as the generic timing core.

Desired benchmark characteristics:

- separate `OpenMs`, `ActionMs`, `CloseMs`
- explicit benchmark name
- staged seed documents
- compact summary per run
- enough metadata to compare across environments later

### 2. Parameter-assignment benchmark lane

Already started directionally and should remain lightweight.

Benchmark targets:

- fast global set path (`TrySetUnsetFormula`)
- per-type coercion path (`SetValue(...CoerceByStorageType)`)
- later: operation-level `SetKnownParams`

Outputs should emphasize:

- type count
- storage/spec mix
- action time per path
- whether result state matches expected normalized snapshots

### 3. Family element dependency scaling harness (high priority)
Build a dedicated harness to generate families with controlled dependency complexity and measure scaling.

#### Goal
Quantify how operations behave as interdependence increases, not just raw element count.

#### Variables to control
- family type count
- family parameter count
- labeled dimension count
- array count
- connector count
- direct parameter associations to element parameters
- formula dependency depth
- formula dependency fan-out / fan-in
- mixed direct + formula dependency graphs
- disconnected vs highly connected parameter sets
- number of geometry elements driven by shared driver params
- number of reference planes / dimensions reused across multiple dependents

#### Non-exhaustive dependency surfaces to model
Use `source/Pe.Revit.Extensions/FamParameter/GetAssociated.cs` as a starting point, while assuming it may be incomplete or partially wrong.

Potential dependency/association surfaces:
- labeled dimensions
- arrays
- connectors via `GetAssociatedFamilyParameter`
- directly associated element parameters (`AssociatedParameters`)
- formula dependencies / dependents
- likely future additions if discovered:
  - nested family parameters / nested instances
  - reporting parameters
  - constraints / lock-driven references
  - parameter-driven geometry dimensions
  - visibility / material / family-type parameters
  - built-in family element parameters that indirectly participate in state replay
  - new `SetValue`-like method that dynamically generate formulas, then unsets them to bypass traditional per type value switching

#### Harness requirements
- author families in-memory when possible
- generate dependency graphs from compact specs
- expose a normalized summary of the generated graph
- allow controlled sweeps such as:
  - 10 / 50 / 100 / 500 params
  - shallow vs deep formula chains
  - sparse vs dense association graphs
  - single-driver vs hub-and-spoke vs layered graph topologies
- time key operations independently, e.g.:
  - dependency collection
  - association queries
  - snapshot collection
  - parameter setting
  - type switching
  - replay / rebuild phases

#### Deliverables
- dependency graph spec model
- family builder harness for those specs
- normalized dependency snapshot/probe model
- explicit performance tests using generated graphs

---

## Association-method testing roadmap (high priority)

Build focused tests for the association helpers themselves, especially in `FamParameter/GetAssociated.cs`.

### Methods to test
- `AssociatedDimensions`
- `AssociatedArrays`
- `AssociatedConnectors`
- `HasDirectAssociation`
- `HasAnyAssociation`
- any companion formula-dependency helpers used by `HasAnyAssociation`

### Desired assertions
For each method, prove both positive and negative cases:
- no association
- one association
- multiple associations of same kind
- mixed associations
- phantom / invalid / filtered-out cases
- parameter with formula dependents but no direct physical associations
- parameter with direct associations but no formula dependents
- parameter with both

### Important validation questions
- Are `AssociatedParameters` and the negative-ID / missing-element filtering rules actually correct?
- Are connector associations complete, or are some connector parameter surfaces missed?
- Are arrays only valid for `SpecTypeId.Int.Integer`, or are there edge cases?
- Does the dimension filter catch all relevant labeled dimensions in family docs?
- Should reporting parameters or special family element cases be treated as associations here or elsewhere?

### Desired style
These tests should prefer generated mini-families over heavy fixtures unless a regression requires a known authored family.

---

## Snapshot / portable-state roadmap

The long-term value is not just benchmarking isolated API calls. It is proving that family state can be externalized and re-applied.

### Needed proofs
- parameter snapshots faithfully capture intended replayable state
- snapshot projection rules are explicit and testable
- authored settings derived from snapshots are stable enough to roundtrip
- replay produces the same normalized family state, not merely "no exception"

### State classes worth treating as portable data
- family parameter definitions
- per-type parameter values / formulas
- parameter dependency summaries
- reference plane + dimension intent
- param-driven geometry intent
- connector intent / driving params
- selected project/family context needed for replay

### State classes that may remain partially lossy
- incidental element IDs
- ephemeral API-only handles
- UI-only state
- undocumented Revit-internal ordering where determinism is weak

Tests should make these boundaries explicit.

---

## Practical implementation guidance

### Prefer next
1. keep strengthening harnesses, not multiplying test files
2. add a dependency-graph family builder harness
3. add direct tests for `GetAssociated` methods
4. add one or two scaling benchmarks using generated dependency graphs
5. only then expand coercion/snapshot/operation suites if the seams feel stable

### Avoid for now
- broad migrator end-to-end suites
- many fixture-heavy tests
- overly specific assertions on incidental geometry ordering
- performance tests that mix setup cost with action cost without labeling it

---

## Success criteria

This effort is succeeding if `Pe.Revit.Tests` gives:
- a trustworthy benchmark lane for comparing real Revit behavior
- a reusable family harness vocabulary for creating and probing parameterized families
- auditable proofs for association/dependency behavior
- growing evidence that family/document state can be treated as declarative, portable, serializable data instead of trapped live API state

If tradeoffs are needed, bias toward **better harnesses + better probes + better scaling benchmarks** over raw test-count growth.
