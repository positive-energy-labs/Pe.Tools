# Duplicate and unused-code analysis pilot, 2026-11-04

Candidate `t3/duplicate-code-analysis-pilot`, managed checkout `C:\Users\kaitp\.t3\worktrees\Pe.Tools\t3-78bfe34d`, HEAD `5ad5625fdd09663d446f55e82373c907ce179a23`. No commits, merges, PRs or production fixes. Parent files outside this report and its evidence directory were untouched.

## Verdict

The useful results are repeated domain rules, not a large duplication percentage. The strongest copies are tap projection, formula splitting, parameter scope selection and schedule resolution. Several differ at consequential policy edges. Treat extraction as a design task with explicit behavior preservation, not a mechanical cleanup. Twelve families below were manually inspected. No deletion or runtime defect is certified.

PROVEN[artifact, parent .artifacts/runs/analysis-20261104/duplicates, 5ad5625fdd09663d446f55e82373c907ce179a23, 2026-11-04 America/Chicago]. Pinned tools produced the saved reports. PROVEN[deterministic, import-probe.stdout, 5ad5625fdd09663d446f55e82373c907ce179a23, 2026-11-04 America/Chicago] for the five parser inputs only. UNPROVEN[Revit behavior, runtime reachability and safe extraction/deletion were not exercised].

## Reproduction and scope

The execution script [analyze.py](../../.artifacts/runs/analysis-20261104/duplicates/analyze.py) runs each command through [run.py](../../.artifacts/runs/analysis-20261104/duplicates/run.py). Each `<name>.meta.json` contains exact argv, explicit cwd, exit and elapsed seconds; paired `.stdout` and `.stderr` files contain full unfiltered output. [whole.py](../../.artifacts/runs/analysis-20261104/duplicates/whole.py) widens jscpd from ts/dotnet to the complete checkout. Source anchors below resolve to frozen baseline copies in the parent evidence directory, not concurrent parent source. [baseline-source-manifest.json](../../.artifacts/runs/analysis-20261104/duplicates/baseline-source-manifest.json) contains Git blob IDs and SHA256 for those copies. [authored-manifest.json](../../.artifacts/runs/analysis-20261104/duplicates/authored-manifest.json) hashes tracked authored TS/C# inputs with separate production/tooling and test/support labels.

Workspace setup: `vp.exe i --frozen-lockfile --prefer-offline` in this checkout’s `ts` (41.25 s). Tools: `npm.cmd install --prefix .artifacts/analysis-tools --no-audit --no-fund --save-exact fallow@3.39.0 jscpd@5.4.2` (4.67 s). Prefix is inside this disposable worktree. No global install. Node v25.7.0, Vite+ CLI v1.0.0, Fallow 3.39.0, jscpd 5.4.2, configured workspace Knip **6.37.0** (despite knip.json’s schema URL naming v5). [tool-package-lock.json](../../.artifacts/runs/analysis-20261104/duplicates/tool-package-lock.json) freezes tool dependencies.

Help was consulted before running flags: [fallow-help-v2.stdout](../../.artifacts/runs/analysis-20261104/duplicates/fallow-help-v2.stdout), [fallow-dead-help.stdout](../../.artifacts/runs/analysis-20261104/duplicates/fallow-dead-help.stdout), [fallow-dupes-help.stdout](../../.artifacts/runs/analysis-20261104/duplicates/fallow-dupes-help.stdout), [jscpd-help-v2.stdout](../../.artifacts/runs/analysis-20261104/duplicates/jscpd-help-v2.stdout), [knip-help.stdout](../../.artifacts/runs/analysis-20261104/duplicates/knip-help.stdout). jscpd lists `csharp`, `typescript`, `tsx`; its `--similarity` help explicitly includes C#. The C# AST results include meaningful formula and collector matches. Mori was therefore unnecessary. No embedding model, signup, cloud service, secret or paid feature was used.

Exclusions: node_modules, dist, dist-installed, .artifacts, bin, obj, generated and vendor directories, `*.generated.*`, `*.g.cs`, AssemblyInfo.cs and routeTree.gen.ts. [fallow-config.json](../../.artifacts/runs/analysis-20261104/duplicates/fallow-config.json) records Fallow exclusions; jscpd exclusions are in its meta argv. Root jscpd passes used format typescript,tsx,csharp, 80 tokens, 8 lines, four workers. Normalized pass: weak mode, consistent identifier renaming and literal normalization. Structural pass: `--similarity=0.85 --min-nodes 35 --kind ast`. Full HTML/JSON reports: [jscpd-token-all/jscpd-report.html](../../.artifacts/runs/analysis-20261104/duplicates/jscpd-token-all/jscpd-report.html), [jscpd-token-all/jscpd-report.json](../../.artifacts/runs/analysis-20261104/duplicates/jscpd-token-all/jscpd-report.json), [jscpd-structural-all/jscpd-report.html](../../.artifacts/runs/analysis-20261104/duplicates/jscpd-structural-all/jscpd-report.html), [jscpd-structural-all/jscpd-report.json](../../.artifacts/runs/analysis-20261104/duplicates/jscpd-structural-all/jscpd-report.json).

Fallow strict is AST-token exact matching, not byte equality. Its installed schema says strict/mild are equivalent under its tokenizer; semantic mode blinds identifiers and literals. `semantic --near` is bounded near-miss matching, not embedding inference. It excludes import wiring by default. No changed-since/history filter was used. No history inactivity was interpreted as runtime coldness.

## Run checkpoints

Each analysis was checkpointed after completion in the setup report; final metadata remains the reproducible record. Durations include process startup. Exit 1 from dead-code/Knip reports findings, not a tool crash.

| Run | Duration | Exit | Coverage and interpretation |
|---|---:|---:|---|
| [fallow-dead.meta.json](../../.artifacts/runs/analysis-20261104/duplicates/fallow-dead.meta.json) | 2.36 s | 1 | Default graph plus authored-output exclusions; workspace discovery warnings. |
| [fallow-typed.meta.json](../../.artifacts/runs/analysis-20261104/duplicates/fallow-typed.meta.json) | 39.53 s | 1 | Semantic companion runs; incomplete coverage prevents negative proof. |
| [fallow-strict.meta.json](../../.artifacts/runs/analysis-20261104/duplicates/fallow-strict.meta.json) | 0.77 s | 0 | Whole TS graph duplication; no output truncation/top filter. |
| [fallow-normalized-near.meta.json](../../.artifacts/runs/analysis-20261104/duplicates/fallow-normalized-near.meta.json) | 1.42 s | 0 | Renamed/literal-normalized and near clones. |
| [knip.meta.json](../../.artifacts/runs/analysis-20261104/duplicates/knip.meta.json) | 10.15 s | 1 | Unmodified repo knip.json baseline, no production-only switch. |
| [jscpd-token-all.meta.json](../../.artifacts/runs/analysis-20261104/duplicates/jscpd-token-all.meta.json) | 1.64 s | 0 | Whole checkout authored-format token scan, JSON and HTML. |
| [jscpd-structural-all.meta.json](../../.artifacts/runs/analysis-20261104/duplicates/jscpd-structural-all.meta.json) | 3.22 s | 0 | Whole checkout AST near pass, C# supported; test functions omitted by detector. |
| [import-probe.meta.json](../../.artifacts/runs/analysis-20261104/duplicates/import-probe.meta.json) | 0.31 s | 0 | Actual import-census and the regex extracted from package-direction source. |

Coverage denominators differ: the authored tracked manifest has 3010 TS/C# files (2062 production/tooling, 948 test/support by explicit heuristic); Fallow duplication analyzes 1266 files. jscpd’s root token pass reports 2817 sources and its structural pass 2858 because token-size filtering and AST analysis differ. These are instrument scope numbers, not missing-code or cleanup counts. Tests and disposable UI prototypes remain in raw token reports; they were separated during review. Files below 80 tokens/8 lines, JS/MJS for jscpd, nonliteral runtime discovery, generated code and ignored files are outside relevant measurements. No equal-scope benchmark or false-positive rate is claimed.

## Ranked reviewed families

### 1. Tap-distance geometry

Similarity: AST near 0.857; 341-token normalized block. Sources: [ts/packages/ducts-domain/src/kernel/fitting-facts.ts:176](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/packages/ducts-domain/src/kernel/fitting-facts.ts#L176), [ts/packages/ducts-domain/src/losses.ts:348](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/packages/ducts-domain/src/losses.ts#L348).

Both project a tap onto each polyline leg, accumulate arc length, reverse for upstream orientation, and clamp to duct length. The kernel receives an upstream connector; losses resolves it using parent/root equipment. Shared hard geometry, with caller-specific orientation discovery. A pure projection helper could remove repeated math; moving parent/root discovery into it would blur the seam. No numerical defect established.

### 2. Formula argument splitting

Similarity: AST near 0.859. Sources: [dotnet/Pe.Revit.FamilyFoundry/LookupTables/LookupFormulaInspector.cs:104](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit.FamilyFoundry/LookupTables/LookupFormulaInspector.cs#L104), [dotnet/Pe.Revit/Extensions/FamDocument/SetFormula.cs:215](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit/Extensions/FamDocument/SetFormula.cs#L215).

Both maintain quote state and parenthesis depth, split only on top-level commas, and trim emitted arguments. Inspector calls Formula.IsInchMarkSafeDelimiter; SetFormula calls IsStringDelimiter. A shared formula tokenizer could prevent drift on quoted inch marks and nested calls. First establish equivalence of delimiter policy; a generic CSV splitter would lose the formula rules.

### 3. Parameter scope resolution

Similarity: AST near 0.873; 328-token normalized block. Sources: [dotnet/Pe.Revit.DocumentData/Parameters/ParameterCoverageCollector.cs:158](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit.DocumentData/Parameters/ParameterCoverageCollector.cs#L158), [dotnet/Pe.Revit.DocumentData/Parameters/ParameterEvidenceCollector.cs:182](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit.DocumentData/Parameters/ParameterEvidenceCollector.cs#L182).

Both resolve selection, explicit numeric/unique IDs, active-view elements, then document fallback and category filtering. Evidence additionally refuses a fallback with no candidate parameters and caps fallback at 1000; coverage does neither. Shared responsibility with deliberate budgets and distinct issue codes. A scope resolver with explicit fallback/budget policy may help; blindly merging bodies could broaden evidence or truncate coverage.

### 4. Schedule name/reference resolution

Similarity: AST near 0.880; 174-token normalized block. Sources: [dotnet/Pe.Revit.DocumentData/Schedules/Collect/ScheduleProfileQueryCollector.cs:140](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit.DocumentData/Schedules/Collect/ScheduleProfileQueryCollector.cs#L140), [dotnet/Pe.Revit.DocumentData/Schedules/Collect/ScheduleQueryCollector.cs:171](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit.DocumentData/Schedules/Collect/ScheduleQueryCollector.cs#L171).

Both trim and deduplicate requested names, enumerate candidates, match case-insensitively, emit not-found diagnostics, and deduplicate IDs. Profile permits IncludeTemplates; rendered query excludes templates. Shared resolution logic, different result kinds and warning codes. A document-owned resolver could preserve one name policy; it must retain the template option and requested-count semantics.

### 5. Search tokenization and handle deduplication

Similarity: 181-token normalized block, inspected exact code. Sources: [dotnet/Pe.Revit.DocumentData/ProjectBrowser/ProjectBrowserCollector.cs:348](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit.DocumentData/ProjectBrowser/ProjectBrowserCollector.cs#L348), [dotnet/Pe.Revit.DocumentData/ProjectIndex/ProjectIndexCollector.cs:502](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit.DocumentData/ProjectIndex/ProjectIndexCollector.cs#L502).

The lowercase/alphanumeric split, length cutoff, stop-word list, and composite handle key are the same. This is shared ranking/identity policy rather than DTO boilerplate. A private DocumentData helper could prevent search behavior diverging. Keep browser and semantic index collection separate; do not turn token similarity into a claim about BIM identity.

### 6. Apply-store projection

Similarity: 245-token normalized block. Sources: [ts/packages/ducts-domain/src/kernel/apply-request.ts:121](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/packages/ducts-domain/src/kernel/apply-request.ts#L121), [ts/packages/ducts-domain/src/pricing.ts:588](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/packages/ducts-domain/src/pricing.ts#L588).

Both spread the stored state, set version 2, uppercase rule tables, and overlay timestamped fitting instances, terminal losses, and flows. The surrounding slot/ruling policies differ: kernel merges input slots and preserves verdicts/roles; pricing uses snapshot slots and storeRulings. A helper for the repeated map overlays could help data integrity. Combining whole apply requests would hide real policy differences.

### 7. Sheet freshness and scope body rules

Similarity: Fallow strict 150 tokens; normalized/near 160. Sources: [ts/apps/web/src/ducts/neutral.ts:1340](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/web/src/ducts/neutral.ts#L1340), [ts/apps/web/src/fans/neutral.ts:472](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/web/src/fans/neutral.ts#L472).

Both require current sheet evidence and the matching basis before edits, describe input history, write writeIntent, and describe scope. This repeats user-facing admission policy, not just bindings. A typed reusable body group could prevent one route weakening freshness. Preserve route-specific edit patch preparation immediately before this block and each body source provenance.

### 8. Reading source lifecycle

Similarity: Fallow normalized/near 174 tokens; jscpd normalized 212. Sources: [ts/apps/web/src/shell/readings-api.ts:116](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/web/src/shell/readings-api.ts#L116), [ts/apps/web/src/shell/readings-api.ts:154](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/web/src/shell/readings-api.ts#L154).

opSource and composeSource both compute nullable input, deliver absent revision 0, await transport, optionally map, deliver revision 1, and suppress failure delivery after abort. Their transports and schemas differ. Shared lifecycle helper could centralize cancellation/error semantics. It must preserve OpKey/PeRouteId input-output correlation; do not erase types to save a short body.

### 9. Safe path composition

Similarity: AST near 0.869. Sources: [dotnet/Pe.Shared.Product/ProductPathing.cs:47](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Shared.Product/ProductPathing.cs#L47), [dotnet/Pe.Shared.StorageRuntime/SettingsPathing.cs:7](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Shared.StorageRuntime/SettingsPathing.cs#L7).

Both normalize a relative path, combine it below a root, take a full path and verify containment. Empty subdirectory returns a full path in ProductPathing but the supplied root in SettingsPathing; JSON extension policy belongs only to storage. Consolidation may help path invariants if rooted in the lower Product package. Preserve those return and extension semantics rather than assuming equality.

### 10. Repository import scanners

Similarity: Manual responsibility overlap; not a three-way exact clone. Sources: [ts/tests/repo-guards/src/import-census.ts:26](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/tests/repo-guards/src/import-census.ts#L26), [ts/tests/repo-guards/src/package-direction.guard.test.ts:12](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/tests/repo-guards/src/package-direction.guard.test.ts#L12), [ts/tests/repo-guards/src/unification-2-census.ts:392](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/tests/repo-guards/src/unification-2-census.ts#L392).

Test/tooling category. import-census uses an AST and returns original imported names; package-direction uses a regex and raw name text; unification walks AST nodes, resolves targets, records dynamic modules and retains node identity. Deterministic probe proves the regex misses side-effect imports, dynamic imports and require, and matches a commented import. A shared syntax enumerator may help; unification needs node/provenance data, so replacing it with a string-only census would hurt. This is behavioral duplication, not equivalent parsers.

### 11. Family pre/post snapshot wrappers

Similarity: AST normalized score 1.000. Sources: [dotnet/Pe.Revit.FamilyFoundry/FamilyProcessingPipeline.cs:248](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit.FamilyFoundry/FamilyProcessingPipeline.cs#L248), [dotnet/Pe.Revit.FamilyFoundry/FamilyProcessingPipeline.cs:273](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit.FamilyFoundry/FamilyProcessingPipeline.cs#L273).

Both check context, no-op for null queue, reject a repeated phase, time CollectSnapshot and assign the phase duration. They already call one private collection core. This is phase symmetry with different fields and error messages. Low priority: parameterizing phase field access adds delegates or indirection for little hard-logic gain. The package guidance also questions post-snapshot product coverage; static similarity cannot establish its runtime value.

### 12. Route pane and codec registration

Similarity: Fallow normalized/near 81/113-token groups. Sources: [ts/apps/web/src/ducts/kernel.tsx:50](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/web/src/ducts/kernel.tsx#L50), [ts/apps/web/src/fans/kernel.tsx:76](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/web/src/fans/kernel.tsx#L76), [ts/packages/agent-contracts/src/route-kernel-bodies.ts:25](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/packages/agent-contracts/src/route-kernel-bodies.ts#L25).

Pane bindings repeat slot/kind/source/createElement; codec lists repeat jsonCodec(schema). These are typed registration declarations rather than copied hard logic. BodyBindings enforces a useful explicit contract. A factory could reduce spelling but obscure source/slot provenance and generic correlation. Keep below domain-rule copies in priority; no evidence that route-kernel contracts themselves duplicate the route adapters.

## Rejected hypotheses and instrument noise

**Space/Partition:** normalized tokens match unrelated constant lists. [dotnet/Pe.Revit.Partition/Types.cs:180](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit.Partition/Types.cs#L180) is a partition-reason catalog; [dotnet/Pe.Shared.RevitData/Families/FamilyModelValidator.cs:13](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Shared.RevitData/Families/FamilyModelValidator.cs#L13) is a family diagnostic catalog. Identifier and literal normalization erases their meaning. Their overlap is declaration boilerplate. [dotnet/Pe.Revit.Partition/Verbs.cs:8](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit.Partition/Verbs.cs#L8) documents and implements an adapter calling Space slice/probe, while [dotnet/Pe.Revit.Space/Partition.cs:1](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit.Space/Partition.cs#L1) owns geometry partition state. No substantial repeated cross-package geometry family survived this bounded scan and review; this does not prove absence below thresholds or semantic equivalence.

**FamilyFoundry versus StorageRuntime/FamilyFoundry:** [dotnet/Pe.Shared.StorageRuntime/FamilyFoundry/OperationContracts.cs:8](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Shared.StorageRuntime/FamilyFoundry/OperationContracts.cs#L8) defines settings contracts; [dotnet/Pe.Revit.FamilyFoundry/BaseOperation.cs:30](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Revit.FamilyFoundry/BaseOperation.cs#L30) consumes IOperationSettings, and [dotnet/Pe.Shared.RevitData/Families/FamilyPatch.cs:192](../../.artifacts/runs/analysis-20261104/duplicates/sources/dotnet/Pe.Shared.RevitData/Families/FamilyPatch.cs#L192) references SortParamsSettings. The shared names describe a contract/consumer boundary. No hard-logic clone between these directories was corroborated. Include/exclude DTO repetition is low-value shape duplication.

**DocumentData versus Shared.RevitData:** the important collector duplication was inside DocumentData, above. Shared.RevitData carries portable contracts/validation, not a second implementation of the sampled collectors. Similar property/record shapes alone are not reason to combine a Revit reader with its DTO.

**Self-overlap:** normalized raw jscpd output contains identical/overlapping spans in the same file (for example repeated constants and adjacent generic record fields). These were not ranked as independent copies. Prototype variants and test scaffolding also dominate some large Fallow groups; size alone did not promote them.

## Unused files and exports: manually corroborated candidates

Both Fallow and configured Knip identify the following files. Source/reference searches support review priority, not deletion authority. [references-files.stdout](../../.artifacts/runs/analysis-20261104/duplicates/references-files.stdout), [references-exports.stdout](../../.artifacts/runs/analysis-20261104/duplicates/references-exports.stdout) and [entry-references.stdout](../../.artifacts/runs/analysis-20261104/duplicates/entry-references.stdout) retain the evidence and exact search commands in sibling metadata.

- [ts/apps/web/src/host/familyfoundry.ts:7](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/web/src/host/familyfoundry.ts#L7) and [ts/apps/web/src/host/familyfoundry.ts:46](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/web/src/host/familyfoundry.ts#L46): FF_SPEC_SCHEMA and ffPlanRow only occur in their own definitions in the searched authored TS corpus. The file formats old plan rows. Candidate orphan adapter; dynamic string loading and outside-workspace consumers were not ruled out.
- [ts/packages/mcps/src/shared/takeoff-capture-client.ts:3](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/packages/mcps/src/shared/takeoff-capture-client.ts#L3): readSavedTakeoffText only has its definition. It fetches a saved capture through contextFetch. Strong small orphan-client candidate; no runtime probe.
- [ts/apps/web/src/host/target-ui.tsx:31](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/web/src/host/target-ui.tsx#L31) and [ts/apps/web/src/host/target-ui.tsx:47](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/web/src/host/target-ui.tsx#L47): LiveDot and DeployBadge have definition-only hits. Both tools call the file unused. Candidate unused target presentation surface.
- [ts/apps/web/src/host/world-log.ts:74](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/web/src/host/world-log.ts#L74): useSessionEvents has definition-only hits. Candidate old broker history hook, with nontrivial state logic; exercise consumers before deletion.
- [ts/apps/host/src/demo-rhvac.ts:11](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/host/src/demo-rhvac.ts#L11) imports [ts/apps/host/src/demo-settings.ts:23](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/host/src/demo-settings.ts#L23). Both tools classify the component as unused. These are demo/support files, not active-production removal recommendations. demo-settings also has a ratchet-baseline citation, so removal would require updating that knowledge.

Export-only findings have a different meaning. [ts/apps/host/src/ducts-inputs.ts:18](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/host/src/ducts-inputs.ts#L18) firmFilePath and FIRM_SEED are used internally by readFirm (lines 43–54), while [ts/apps/host/src/ducts-sheet.ts:169](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/host/src/ducts-sheet.ts#L169) sheetReach is called at line 359. [ts/apps/host/src/harness/spawner.ts:21](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/host/src/harness/spawner.ts#L21) CHILD_EXIT_GRACE is used at line 56 and cited in adapter documentation. [ts/apps/host/src/run-consent.ts:16](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/host/src/run-consent.ts#L16) WRITE_COUNTDOWN_MS, windowDeadline and consentWindow are used in the same module. The corroborated opportunity is to review **export visibility**, not delete their logic. Both tools flag the host re-export of mergeCriteria at ducts-inputs.ts:77; its canonical implementation is used in ducts-domain.

## Fallow/Knip disagreements and entrypoint gaps

Configured Knip marks 13 unused files; all 13 are also Fallow unused-file candidates. Fallow marks 29 additional files. This is not evidence of 29 extra safe deletions. [dead-review.txt](../../.artifacts/runs/analysis-20261104/duplicates/dead-review.txt) preserves exact set comparisons. Important differences:

- Fallow flags fake-acp-agent.mjs; [ts/apps/host/tests/harness-threads.test.ts:130](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/host/tests/harness-threads.test.ts#L130) explicitly supplies that executable path to the harness. [ts/knip.json:27](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/knip.json#L27) declares it an entry. This is a corroborated Fallow entrypoint false positive.
- [ts/knip.json:33](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/knip.json#L33) declares factory actuator/sensor scripts as entries. Fallow flags echo.ts, loc.ts and markers.ts. Manual/plugin-entry mapping is needed before evaluating these and the listed web proof scripts or e2e files.
- Both tools flag .typecheck.ts files, including [ts/packages/agent-contracts/src/route-kernel-work-description.typecheck.ts:10](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/packages/agent-contracts/src/route-kernel-work-description.typecheck.ts#L10). It contains @ts-expect-error negative contracts. [ts/packages/agent-contracts/tsconfig.json:1](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/packages/agent-contracts/tsconfig.json#L1) has default project inclusion and [ts/apps/web/tsconfig.json:2](../../.artifacts/runs/analysis-20261104/duplicates/sources/ts/apps/web/tsconfig.json#L2) explicitly includes TS/TSX files. Import-graph unreachability does not make compiler assertions unnecessary. Keep these in the test category.
- Fallow flags exports in route entry files that Knip protects with route entry globs; generated routing and package exports also change reachability assumptions. Bodies/codecs used locally to assemble module exports can be unused exports without being unused functions.
- Fallow warns that tools/* names a missing directory, tests/e2e and tests/isolated-home match workspaces with no package.json, and two manifest command entrypoints traverse outside the TS root toward dotnet/Pe.Dev.Cli. These are disclosed coverage boundaries, not reasons to edit package manifests in this pilot.

Type-aware Fallow took 39.53 s. It retained all 155 unused-export candidates rather than confirming them closed-world: 139 report incomplete-project-coverage, 10 blocking-diagnostics, four dynamic-behavior, one abstention without that reason and one unknown-symbol. Unused types changed from 52 to 47, but the export/file deletion confidence did not improve. [fallow-typed.stdout](../../.artifacts/runs/analysis-20261104/duplicates/fallow-typed.stdout) retains per-symbol semantic decisions and omissions. No TypeScript compilation or owning-project repairs were attempted. The two tools ran their own supported configurations rather than a falsely equivalent common entry model.

## Diagnostics, limits and cleanup

Initial Python launches of relative forward-slash .cmd paths failed with WinError 2; inspection confirmed installed .cmd shims. The changed invocation uses node plus an absolute package entry, and succeeded. Empty initial help stdout/stderr files are retained; they are not analyzers returning empty results. A local summary reader initially used Windows cp1252 and failed on UTF-8 report bytes; the changed readers specify UTF-8. One documentation search named an absent installed docs directory; schema.json/README and captured CLI help supplied the capability evidence. Read-only probes also guessed absent route-kernel.ts and Partition/Partition.cs; inventories corrected the paths. No failed scan was repeated unchanged. The report generator also encountered PowerShell 5.1 default cp1252 output; it was transcoded to UTF-8 before execution. These diagnostic boundaries did not mutate source.

The timeout runner caps a command at 360 s and targets only its own subprocess tree if needed; no run hit that limit. Long installs/type-aware analysis ran behind session handles and were polled. All launched analysis/install/probe commands exited. No server, Revit session, agent, worktree, global tool, external account, deployment or build was started. Native/Revit/installed proof remains outside this research scope.

Actual delta: production 0 files / +0 -0 lines; test/fixture changes 0; worktree tracked changes 0. One authorized parent research report plus evidence scripts/configs/logs/JSON/HTML and frozen source copies were created. Ignored local installs remain disposable in the managed worktree for its owner to retire. No processes remain to stop and no cleanup debt was created. Final status captured in [final-state.json](../../.artifacts/runs/analysis-20261104/duplicates/final-state.json). Research follow-up, if authorized, is to select one domain family and prove its differing policies before extraction; this pilot proposes no cleanup diff.
