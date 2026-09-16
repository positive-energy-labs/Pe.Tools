# Portable Pods Ledger

## Decided

- 2026-09-16: One pod boundary may contain scripts, typed settings, assets, and explicit external requirements; entrypoints are optional so settings-only pods are valid.
- 2026-09-16: Working copies are editable. Releases are immutable content-addressed snapshots. An imported release becomes an independent working copy with exact parent release ancestry; origin is only a transport locator.
- 2026-09-16: Preparation captures the positive input set, verifies exact dependency release hashes, composes typed settings, validates entrypoint structure, and computes one stable snapshot hash before execution.
- 2026-09-16: Stable content identity is SHA-256 over sorted `path + NUL + file SHA-256 + LF` rows for semantic manifest inputs and executable/relevant content. Display metadata, origin, ancestry, output, inspection copies, and `release.json` are excluded.
- 2026-09-16: `$preset` and `$include` compose at source level. Releases retain authored settings and ship composed JSON; only consumed foreign source documents are copied for inspection and those copies never execute.
- 2026-09-16: Publication selects `pod.json`, `PeScripts.csproj`, `src/`, `settings/`, `composed/`, `assets/`, and consumed inspection copies. Pod-local output directories are user-owned current output storage and are excluded.
- 2026-09-16: Parameters Service is authoritative for `aps.parameters` requirements. Feature actions resolve the current collection without cache fallback immediately before execution, require the declared resource, then run their existing semantic validation over the prepared composed value.
- 2026-09-16: JSON members remain reusable typed content; feature libraries offer actions for recognized content, while only scripts declare executable entrypoints. Receipts identify the selected member and actual operation without creating an authored operation binding.
- 2026-09-16: Script receipts attribute outcome and output references to pod, member, actual operation, run id, exact prepared snapshot, and release hash when the snapshot is an unchanged release.

## Tried & rejected

- 2026-09-16: Runtime palette stacking; composition must be deterministic during preparation and publication.
- 2026-09-16: Bundled or cached Parameters Service definitions; inspection copies and releases are not authority fallbacks.
- 2026-09-16: Whole sibling-pod embedding; releases carry only source dependency documents actually consumed during composition.
- 2026-09-16: Automatic update or merge; adopting a newer dependency or ancestor remains an explicit edit.
- 2026-09-16: A universal JSON/script entrypoint abstraction; typed JSON does not become executable merely by appearing in a pod manifest.

## Owed

- 2026-09-16: Prove FF and Schedule execution plus Parameters Service resolution against a controlled Revit session and a real APS account; compile and deterministic tests cannot establish those runtime claims.
- 2026-09-16: Add Git or cloud transport only when a product workflow selects it; archive transport remains the implemented carrier.
