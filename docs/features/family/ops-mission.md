MISSION: Expose FamilyFoundry as typed host bridge ops. Work in THIS worktree (branch family-fresh, already synced to main @ 5b286d0). Do NOT touch apps/web/src routes or components.

CONTEXT. Pe.Revit.FamilyFoundry already contains the tested engine: DocumentFamilyProfileApplyExtensions (ApplyFamilyProfile / ApplyFamilyMigrationProfile / ApplyDesiredFamilyMigrationProfile), the desired-state plan compiler (DesiredParameterCompiler + DesiredMigrationPlanLowerer -> FamilyMigrationReconciliationPlan with per-field provenance), and FamilySnapshotProfileProjector (snapshot -> runnable profile). Existing bridge-op patterns to follow exactly: source/Pe.Shared.HostContracts/Operations/RevitBridgeOps.cs (family.editor.* ops), source/Pe.App/Host/FamilyModelBridgeOps.cs (handler registration via assembly scan in BridgeAgent.cs), wire-compat pinning like Pe.Shared.Tests/RevitData/FamilyEditorSnapshotWireCompatTests.cs. Operation metadata supports SupportedActiveDocumentKind and ReadOnly vs Mutate permission modes.

DELIVERABLE 1 (census first — this is deliverable #1 even if nothing else lands): docs/features/family/OPS-CENSUS.md mapping each new op -> library entry point -> input/output DTO shape -> proof lane. Investigate and record which profile shape the plan compiler actually accepts (DesiredFamilyMigrationProfile vs FFMigratorProfile) and pick the desired-state path where possible.

DELIVERABLE 2 — four typed ops, contracts + handlers + registration:
1. familyfoundry.plan (ReadOnly, ProjectOnly): input = profile JSON (inline payload, never a filesystem path) + optional familyId filter. Output = per-family reconciliation plan projection incl. per-field provenance and a deterministic planHash (stable serialization -> SHA256). Web-side fail-fast: unknown/stale profile fields must produce named diagnostics in the op result, not silent tolerance.
2. familyfoundry.apply (Mutate, ProjectOnly): input = profile JSON + explicit familyIds list + expectedPlanHash. Recompile the plan inside apply; echo planHash; if it differs from expectedPlanHash, refuse with a drift diagnostic before mutating. Execute per family via the migration pipeline; output per-family receipts: ops run, params changed count, diff summary, artifact directory path, success/failure per family (failures never abort the batch).
3. familyfoundry.project (ProjectOnly; investigate whether snapshot capture of loaded families requires a mutate-mode doc open — record the truth in the census and set the permission mode honestly): input = familyIds. Output = projected dense FFManagerProfile JSON (the FamilySnapshotProfileProjector "dense" projection) as an inline document.
4. host.shell.open: NOT a Revit-document op — find where host-level (non-document) ops are registered and follow that seam. Input = absolute path. Validate existence, then open with the OS default handler (Process.Start UseShellExecute). Output = { opened: bool, path }.

BINDING ACCEPTANCE GATES (all must pass; run them, do not claim them):
- dotnet build green for every touched project (use the repo's normal build entry; see docs/BUILD.md).
- Wire-compat/contract tests added for all four op DTO shapes in the existing no-Revit test lanes, passing via the repo's test command for those projects.
- planHash determinism unit test (same profile -> same hash; field change -> different hash).
- cd source/pe-tools && pnpm codegen && pnpm codegen:check green (offline via pe-dev ops-catalog; no live host needed).
- No changes under apps/web/src except generated client output.
Live-Revit proof is explicitly OUT of scope (recorded in docs/features/family/SHIMS.md).

Commit your own files by pathspec as you go (source/Pe.Shared.HostContracts, source/Pe.App, source/Pe.Revit*, test projects, docs/features/family/OPS-CENSUS.md, generated clients) with conventional messages. Work autonomously; do not ask questions. If a gate is unreachable, stop at the best honest point and write the tradeoff/census into OPS-CENSUS.md.
