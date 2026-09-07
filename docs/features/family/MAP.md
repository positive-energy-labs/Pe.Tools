# Family Foundry completion map

Current effort: 2026-09-06, demiurge with proof-first implementation. The integration tree is
`C:/Users/kaitp/source/repos/Pe.Tools-family`, branch `family/rewrite`, baseline `d2e19ce`.
This map owns the current frontier. Product decisions live in [LEDGER.md](LEDGER.md).
Delete the map when the effort closes. No merge to main or live-product completion is claimed.

## Completion contract

- Explicit family.json specifications are manifested. Unmentioned content stays untouched.
- Bulk parameter migration is the primary acceptance gate. Geometry support stays in scope.
- One family either completes or rolls back. A batch retains successful families and continues.
- No ExtensibleStorage or persistent roundtrip metadata. References and sidecars may travel.
- Apply does not save existing documents. Save/export is explicit.
- /family and /families, their route state, Pea authoring, and script/Pod primitives must agree.
- Restore meaningful deleted tests through cleanroom behavioral acceptance, not obsolete scaffolding.
- Preserve every feature, including unfinished ones, unless the user approves its removal.

## Current checkpoint and proof gates

As of 2026-09-07 06:00 UTC, integration `324d797` plus root fixes is in `Pe.Tools-family`.
Nothing is merged to main or published. No whole user story is closed yet.

| Owner | Current gate | Evidence / next action |
|---|---|---|
| Root | Portable geometry and all supported years | Revit 2023 FF compile now passes after removing newer framework API calls. Revit 2024/2026 compile and runtime remain owed. Four geometry fixtures are still red. |
| Normalize / ffnorm0906 | Company migration and per-family rollback | Production Host composition resolves 43/45 frozen profiles. Reconstruct the missing Dehumidifier fragment, checking git history first (user authorized). Preserve inline preset overrides. Fix wave 5 native parameter failures, then run the old template corpus. |
| Routes / ffroutes0906 | /family and /families on real Revit | Four fixtures and fleet navigation exercised in browser. Native plan/apply receipts through a dedicated controlled dev session remain owed. Pe.App build and shared-fragment editing are in progress. |
| Proof / ffproof0906 | SDK custody, lookup values, nested dependencies | Sole Revit lifecycle owner. Wave 5 test run finished; SDK stop returned stopped. Lookup formula ordering and dependency loading fixes await the next READY integration. |

Fresh controlled Revit 2025 wave 5, frozen root `324d797`, returned **15 passed / 22 failed**
across 37 selected tests. Shared causes: local-to-local ReplaceParameter misuse (8), geometry
alignment (4), residue (3), shared creation (2), plus lookup evaluation, nested naming/loading,
invalid rollback objects and fallback mapping. Failures remain acceptance failures.
Raw evidence: `Pe.Tools-ff-proof/.artifacts/runs/fresh-20260906-ff/wave5`.

Passed runtime checks include raw-value capture under rounded, symbol-suppressed display units,
stale-plan rejection, and dependency refusal/cleanup. Earlier controlled measurements established
that fresh reference planes need regeneration before dimension creation. Root now also settles
labeled dimensions before reading extrusion profile coordinates; alignment acceptance is pending.
Reconciliation errors now name the residual sections/keys rather than only reporting a count.

The SDK repair enables the required adapter without enabling unrelated add-ins, rejects overlapping
leases, and restores the acquired native settings. A reused-parent-PID custody defect surfaced in
wave 5 and is being repaired in `Pe.Revit.Sdk-ff-proof`; final runtime acceptance and adoption remain
owed. User session `pe.app-25` PID 71484 is protected; no workflow may target it for this proof.

Value strategy experiment (fresh controlled Revit 2025, proof `39cde8f`): 12-type Mitsubishi family,
five parameter specs, three alternating repetitions, zero commit/reopen mismatches. Median mutation
cost: batched setters 4867.7 ms; prepopulated-source formulas 924.3 ms; temporary selector 4133.7 ms.
Selector setup and cleanup were included; source seeding was excluded. No selector optimization is
adopted. New numeric parameters report raw zero; blank writes do not restore an unset state.

Root deterministic baseline: 135 web checks, 20 Host checks; routes has subsequent checks for
shared fields/Pea scope. Combined validation is due after final integration. Agent reports live in
PROOF-VALUES.md, PROOF-NORMALIZATION.md and PROOF-ROUTES.md; source and compile claims do not
substitute for route or Revit proof.

## User stories and closure evidence

| Story | Necessary evidence still owed |
|---|---|
| BIM manager authors one portable family | Native JSON and sidecars create a family on each supported year; machine-dependent roots absent |
| BIM manager bulk-normalizes a model | Old unmigrated template plus converted company standards, per-family receipts, exact shared identity, per-type values, associations, connectors and room point |
| BIM manager audits/manages all families | /families snapshot, matrix, selector, plan, apply, drift, failure and repeat-run journeys on Revit |
| Revit user asks Pea to author a family | Pea updates actual route-state/native JSON through current context/capability and target contract |
| Engineer normalizes a third-party family | Text-to-electrical-unit mapping, populated destination preservation under mapping, explicit value override, safe association transfer |
| Developer/Pea uses FF in scripts/Pods | One-family and multi-family mutations through public primitives, transaction/document targeting and load-back proof |
| User reapplies a changed specification | Existing extras preserved, new connector added, explicit value changed, repeated run has no required changes |
| User needs honest partial batch progress | Injected failure fully restores that family; successful siblings persist; failed family has actionable receipt |
| User roundtrips supported content | Capture/parse/rebuild/reopen preserves supported semantics, omissions reported, no persistent metadata |

## Primitive and integration backlog

These are assigned to the current owner or queued behind a named prerequisite; none is waived.

- P1: finish SDK custody repair and acceptance, then adopt coherent SDK bytes through the normal consumer pin.
- N1: shared-definition resolution, GUID/tooltip fidelity, ranked source mapping, ReplaceParameter,
  formula/type-cell/reference renames, coercion, association graph stability, safe source removal.
- N1/P3: blank/default policy keyed by spec; fill-blank-from-source flag separate from explicit JSON values.
- N2: unified per-family transaction boundary, result/error propagation, pre-apply hash, residue and load receipt.
- R1: includes/presets at module/global scopes, native keyed-map composition, nested directives, sidecar paths;
  desktop composition is integrated; shared-fragment edit origin and native dependency composition remain owed.
- R2: stale TS contracts, fixture fallbacks, local fake apply, old build evidence, profile picker,
  durable targeting/binding, scope head and Pea capability context; no second competing route-state owner.
- G1: capture rulings (connector face plane, positional refLines, unsigned datums), native identity,
  dependency-aware deletion/recreation, nested dependency loading, connectors/room point, lookup tables.
- G1: restore FamilyModelRoundtripTests and lookup proof; preserve other rejected deletions until retargeted.
- G2 after P1/N1: full company JSON conversion on copies with behavior census; wire complete route fixtures.
- G3 after N2/R2: end-to-end /family and /families Revit proof; rename Pod with valued and associated params.
- G4: Space/Partition, SDK, targeting and chat-scope changes on other branches are integration dependencies,
  not permission to overwrite concurrent work. Census their concrete effect when a consumer needs them.
- Final: compare feature census before/after, tally architectural/behavior changes, fold findings to ledger,
  retire only this effort's spent processes/worktrees, and merge only coherent proven changes.

## Candidate value-write strategies

| Candidate | Falsifier |
|---|---|
| One type pass with all assignments | Correctness failure or measured unacceptable mechanical-family runtime |
| Uniform set/unset formula | Wrong units, per-type values overwritten contrary to policy, or formula/association loss |
| Source-parameter formula baking | Differing type results fail to survive clear/commit/reopen; unsupported conversions |
| Temporary integer selector plus generated formulas | Setup + evaluation + cleanup loses to the batched pass, leaves metadata, or fails atomic cleanup |

The user favors the temporary selector. Parameter creation speed alone does not settle the result;
selector population, evaluation, clear, regeneration, and cleanup must be timed separately.
No permanent strategy flag or formula compiler is authorized merely by this experiment.

## Current user frontier

- Destination wins conflicting source values. Rewire references and remove the source; transfer failure
  rolls back the family. User ruled 2026-09-07. No cleanup-policy question remains pending.
- Edit inherited content in its shared fragment by default. Raw profile JSON holds the reference;
  an expanded editor must make that origin clear. User ruled 2026-09-06.
- Included fragments merge recursively by field. Later values win; an earlier Width data type
  survives a later Width value-only fragment. User ruled 2026-09-07.
- Measurable authored values require explicit units; Number/Integer stay unitless. Normalize owns
  validation and portable capture, root owns native fixture conversion after the frozen proof run.

## Protected state and evidence boundaries

- Main has substantial concurrent Space/Partition/takeoff and route work. Do not reset/stage it.
- `pe.app-25` is the user's expensive session; latest verified PID 71484, with protected user documents.
  Read current registry before any action, but never mutate this session for the wave.
- Main-only ignored fixture: `source/Pe.Revit.Tests/Fixtures/Projects/Old_Template.rvt`, SHA256
  `8107AD50ADBD7BB9866287F0C8DB9168FD88ABE3132206356B717E24F2EE46B1`.
- Downloads candidate: `MEP_Architect_Project Name_R25_Copy_2025.07.11.rte`, user says likely old
  unmigrated template. Both originals stay unchanged; proof opens disposable copies.
- OneDrive Documents/Pe.Tools settings and workspaces are in scope; originals stay unchanged until
  converted replacements are checked against the company behavior. Cloud template is already migrated.
- All four native fixture tests have fresh failures; no complete geometry roundtrip is accepted.
- `family/rulings` 9d130a5, `family/pod` 80fa435, `family/critic-purge` 6c5fcae are sibling feeders
  from b578789, not a proven merge chain. Do not merge the critic's test deletions.
