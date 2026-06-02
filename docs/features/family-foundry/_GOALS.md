# Family Foundry

## North Star

Make Family Foundry outputs the canonical transparency surface for authoring, debugging, testing, and feature development so every FF workflow can be understood through one stable proof model.

## User Goals

- Understand what an FF run changed without reverse-engineering raw Revit state.
- Reuse captured output as practical authored/profile-shaped input when possible.
- See coherent evidence across logs, snapshots, and profile-shaped projections.

## Developer Goals

- Keep Manager and Migrator output shapes aligned even when their command workflows differ.
- Make desired/declarative state the only external FF parameter authoring model; compile it into operation queues as an internal execution detail.
- Optimize the profile language for direct hand authoring: flat declarations, inline global values/formulas, centralized per-type tables, mapping-data includes, and readable `param:<token>` solids references.
- Treat `run-summary.json`, `family-report.json`, snapshot diffs, projections, and compiled plan artifacts as part of the FF contract.
- Make new FF features define their proof surface up front instead of adding ad hoc debug output later.
- Let tests assert on structural artifacts, not just logs.

## Integration Goals

- Keep cross-package ownership clear:
  - Settings catalog owns authored profile types and profile projection seams.
  - Family Foundry owns runtime execution, capture, and artifact writing.
  - App commands consume the shared FF artifact model instead of inventing command-specific output formats.
- Make the output model discoverable to humans and agents without relying on cursor-rule files.

## Non-Goals

- Do not preserve command-specific output formats once a shared FF artifact model exists.
- Do not preserve legacy per-operation parameter settings as public profile shapes or compatibility aliases.
- Do not reshape desired-state authoring around the legacy operation stack; compile desired state down into internal execution details instead.
- Do not force deeply nested parameter reference objects into hand-authored FF settings where names are the safe family-document identity.
- Do not treat logs as the only audit surface when a stronger structural artifact exists.
- Do not let debugging guidance live only in transient tooling-specific rule files.
