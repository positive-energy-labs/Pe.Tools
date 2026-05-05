# Revit Design Automation

## Mental Model

Think of the current DA lane as a schedule-audit operator workflow, not a generalized workload platform.

- `pe-dev revit automation ...` is the public operator surface.
- `Pe.Dev.Cli` owns parse/print behavior only.
- `Pe.Dev.RevitAutomation` owns persisted auth, repo-local cache, sticky browse context, manifest management, appbundle/activity readiness, workitem submission, receipt inspection, and artifact download.
- `Pe.Dev.RevitAutomation.Worker` is still the thin in-engine shell that opens a cloud model, runs a typed job, and writes artifacts.

The important shift is that operators now work with human-readable ACC names and model paths first. GUIDs, region, and Revit year are resolved late.

## Architecture

### Public operator lanes

- `auth`
  - persisted 3-legged refresh-token-backed login status
- `browse`
  - sticky hub/project/path context plus cached ACC traversal
- `manifest`
  - readable schedule manifest create/update/validate flow
- `submit schedules`
  - resolve manifest entries, ensure shell readiness by year, submit one workitem per model, write a receipt, return immediately
- `inspect`
  - re-open a receipt later, refresh workitem status, parse reports, optionally download artifacts
- `cache`
  - inspect or clear the repo-local best-effort cache

### Local state

- repo-local cache:
  - `.artifacts/automation/cache/`
- repo-local browse context:
  - `.artifacts/automation/state/browse-context.json`
- repo-local submission receipts:
  - `.artifacts/automation/receipts/*.json`
- user-local persisted APS auth:
  - `%LocalAppData%/Positive Energy/Pe.Tools/ApsAuth/tokens.json`

### Shell split

- desktop shell:
  - `Pe.App`
- automation shell:
  - `Pe.Dev.RevitAutomation.Worker`

These remain sibling shells over shared DA-safe runtime packages. DA still does not run desktop startup.

## Key Flows

### Browse and inventory

1. `auth login`
2. `browse hubs`
3. `browse use-hub ...`
4. `browse projects`
5. `browse use-project ...`
6. `browse ls` / `browse cd` / `browse models`

The browse service reuses cached APS discovery unless `--refresh` is passed.

### Manifest authoring

1. `manifest create --path <path>`
2. `manifest add --path <path> --project <project-name> --model-path <project-root-model-path>`
3. `manifest validate --path <path>`

The manifest stays human-readable. It stores project names and canonical model paths, not GUIDs or year metadata.

### Submit now, inspect later

1. `submit schedules --manifest <path>`
2. receive a receipt path immediately
3. `inspect receipt --receipt latest --download-artifacts true`

The submit command validates and resolves manifest entries, ensures the right appbundle/activity for each discovered year, submits one workitem per model, writes a receipt, and exits without polling for final DA status.

## Open Questions

- The internal DA code still contains older parameter-collection and probe-oriented services. They are no longer the public operator model, but deeper code deletion can continue in later cleanup passes.
- Revit year resolution still depends on APS discovery metadata. If APS omits that metadata for a model, live resolution remains the fallback.
