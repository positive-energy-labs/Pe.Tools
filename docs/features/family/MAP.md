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

Integration `8008e19` includes composed desktop/host inputs, current-family apply and fleet navigation,
native fixture readouts, per-family rollback/terminal receipts, offline shared definitions, explicit units,
and one fallback type pass for all mapped parameters. Source integration is not product completion.
Fresh controlled Revit 2025 wave 2 (`9941494`) passed 11/24; wave 3 (`1e24ef0`) passed 3/7.
Wave 3 confirms named-plane reapply, rejected-template cleanup and assembly identity. The four
geometry roundtrips remain red: dimension references, shared creation and portable angle parsing.
Proof owns a bounded dimension diagnostic and lookup value loss; root owns geometry and parsing.
Normalize owns destination-wins reference transfer, no-op planning, company conversion and corpus proof.
Routes owns recursive field composition and the route-to-Revit journey. Four fixtures and fleet
navigation were exercised in the browser; screenshot capture timed out and visual proof remains open.
Root deterministic checks passed 129 web tests, 20 host tests and 6 command-chain tests before the
latest readout/portable-definition integration. Combined validation is due after the current fixes.
The SDK lease now enables only the required adapter, rejects overlapping leases under one mutex,
and restores the exact acquired native settings. Wave 3 restored its original settings, left zero
holds, and left the user's session unchanged. SDK changes remain isolated and unpublished.

The paragraphs below retain the earlier measured experiment and initial ownership context;
the current checkpoint above supersedes their source-only and runtime-pending status.

Checkpoint: integration HEAD `f576a5a` contains the three capture rulings, restored native
roundtrip/lookup acceptance, named-plane deletion repair, and the first normalization slice.
Model contract checks passed 56/56 in the deterministic lane. The restored Revit tests compiled;
their runtime assertions remain unproven. Commit `540154e` closes the desktop composed-input
consumer and accepts native numeric/boolean scalar values in generated settings schemas.

P1 diagnosis is independently corroborated: native settings disabled ricaun and journals 3608/3610
recorded the disabled test application. No pre-existing active quarantine appeared at 04:45:59 UTC.
The proof owner's scoped SDK repair ran one fresh controlled diagnostic in PID 42800: 1/1 passed.
Pe.Revit, FamilyFoundry and test assemblies loaded from the adapter test directory; Pe.App used the
installed shell. The native settings and original fixture hashes were restored/unchanged afterward.
The SDK repair and its cleanup behavior still require final review before adoption.

P2/P3 now have fresh controlled Revit 2025 evidence in the proof tree, code `39cde8f`:
three alternating repetitions on a 12-type Mitsubishi filter-box family from the old template,
five target parameters, zero commit/reopen mismatches. Median mutation times: batched setters
4867.6862 ms; source-parameter formulas 924.2989 ms; temporary selector 4133.6719 ms.
Source parameters were already populated, so that timing applies to migration from existing data.
Selector creation/population/cleanup are included. Existing formulas and associations survived;
injected failure rolled back the selector and values. No selector optimization is adopted yet.
New Number/Integer/Temperature parameters reported HasValue=true/raw zero; blank writes were
rejected. The existing uniform helper falsely succeeded with a rounded 0 K literal; `39cde8f`
repairs formatting and clear-error reporting. Broader units/cultures remain unproven.

R1/R2 first consumer slice `8c36c0d` is ready in the route tree: composed native payloads,
native parameter projection, four direct fixture links, per-family hashes and receipts.
Deterministic checks pass there; current-family Apply, browser and runtime proof remain open.

Every agent is Astra medium. One writer per tree. Only proof owns Revit runtime runs this wave.
Initial agent time box is 25 minutes; an intermediate report is due by 8 minutes.

| ID | Owner / Herdr session | Worktree / branch | Claim and first gate | State |
|---|---|---|---|---|
| P1 | proof / ffproof0906 | Pe.Tools-ff-proof / family/proof | Diagnose zero-result fresh run; execute a real 2025 specimen | OPEN |
| P2 | proof / ffproof0906 | Pe.Tools-ff-proof / family/proof | Compare temporary selector formulas, source formula baking, and one batched type pass; reopen and verify | OPEN |
| P3 | proof / ffproof0906 | Pe.Tools-ff-proof / family/proof | Distinguish unset, explicit zero, numeric/temperature defaults, and clearing limits | OPEN |
| N1 | normalize / ffnorm0906 | Pe.Tools-ff-normalize / family/normalize | Restore bulk migration acceptance; explicit values and destination priority; safe source cleanup | OPEN |
| N2 | normalize / ffnorm0906 | Pe.Tools-ff-normalize / family/normalize | Family rollback, pre-mutation plan checks, post-commit/load receipts | OPEN |
| R1 | routes / ffroutes0906 | Pe.Tools-ff-routes / family/routes | Reuse settings composition at execution boundaries; retain raw authoring and diagnostics | OPEN |
| R2 | routes / ffroutes0906 | Pe.Tools-ff-routes / family/routes | Native model loading and truthful route state in /family and /families | OPEN |
| G1 | root | Pe.Tools-family / family/rewrite | Reconcile capture rulings; restore roundtrip and lookup acceptance without hidden metadata | OPEN |

Agent reports are `docs/features/family/PROOF-VALUES.md`, `PROOF-NORMALIZATION.md`, and
`PROOF-ROUTES.md` in the named worktrees. Their claims require independent integration checks.
Raw wave evidence is `.artifacts/runs/fresh-20260906-ff/`; route evidence uses its browser lane.
The prior source census is `.artifacts/ff-census-0906/{core,routes,environment}-report.txt`.

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

- P1: SDK test discovery/load/adapter diagnosis; fix the owning layer, not another watchdog.
- N1: shared-definition resolution, GUID/tooltip fidelity, ranked source mapping, ReplaceParameter,
  formula/type-cell/reference renames, coercion, association graph stability, safe source removal.
- N1/P3: blank/default policy keyed by spec; fill-blank-from-source flag separate from explicit JSON values.
- N2: unified per-family transaction boundary, result/error propagation, pre-apply hash, residue and load receipt.
- R1: includes/presets at module/global scopes, native keyed-map composition, nested directives, sidecar paths;
  desktop raw-file execution is root's follow-up after the shared composition contract is settled.
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
- The four prior native fixture tests have no accepted fresh proof. Green build is not Revit evidence.
- `family/rulings` 9d130a5, `family/pod` 80fa435, `family/critic-purge` 6c5fcae are sibling feeders
  from b578789, not a proven merge chain. Do not merge the critic's test deletions.
