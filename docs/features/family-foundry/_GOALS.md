# Family Foundry

## North Star

Make Family Foundry outputs the canonical transparency surface for authoring, debugging, testing, and feature development so every FF workflow can be understood through one stable proof model.

## User Goals

- Understand what an FF run changed without reverse-engineering raw Revit state.
- Reuse captured output as practical authored/profile-shaped input when possible.
- See coherent evidence across logs, snapshots, and profile-shaped projections.

## Developer Goals

- Keep Manager and Migrator output shapes aligned even when their authored workflows differ.
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
- Do not treat logs as the only audit surface when a stronger structural artifact exists.
- Do not let debugging guidance live only in transient tooling-specific rule files.
