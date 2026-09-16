# Portable Pods Ledger

## Decided

- 2026-09-16: Batch actions use one prepared snapshot for all members; a missing pod member cannot fall back to a legacy settings directory or a newer snapshot.
- 2026-09-16: Feature output and saved script receipts belong in unique run directories under the pod's excluded `output/`; failure receipts use only the snapshot prepared for that attempt.

- 2026-09-16: One pod boundary may contain scripts, typed settings, assets, and explicit external requirements; entrypoints are optional so settings-only pods are valid.
- 2026-09-16: Working copies are editable. Releases are immutable content-addressed snapshots. An imported release becomes an independent working copy with exact parent release ancestry; origin is only a transport locator.
- 2026-09-16: Preparation captures the positive input set, verifies exact dependency release hashes, composes typed settings, validates entrypoint structure, and computes one stable snapshot hash before execution.
- 2026-09-16: Stable content identity is SHA-256 over sorted `path + NUL + file SHA-256 + LF` rows for semantic manifest inputs and executable/relevant content. Display metadata, origin, ancestry, output, inspection copies, and `release.json` are excluded.
- 2026-09-16: `$preset` and `$include` compose at source level. Releases retain authored settings and ship composed JSON; only consumed local or foreign source dependency documents are copied for inspection and those copies never execute.
- 2026-09-16: Publication selects `pod.json`, `PeScripts.csproj`, `src/`, `settings/`, `composed/`, `assets/`, and consumed inspection copies. Pod-local output directories are user-owned current output storage and are excluded.
- 2026-09-16: Parameters Service is authoritative for `aps.parameters` requirements. Feature actions resolve the current collection without cache fallback immediately before execution, require the declared resource, then run their existing semantic validation over the prepared composed value.
- 2026-09-16: JSON members remain reusable typed content; feature libraries offer actions for recognized content, while only scripts declare executable entrypoints. Receipts identify the selected member and actual operation without creating an authored operation binding.
- 2026-09-16: Script receipts attribute outcome and output references to pod, member, actual operation, run id, exact prepared snapshot, and release hash when the snapshot is an unchanged release.
- 2026-09-16: An unchanged imported release executes its verified shipped composed bytes without author dependencies. Any authored edit discards shipped composed/inspection bytes, prepares source again, and retains the imported release as the prepared derivative's parent; missing author dependencies fail specifically instead of running stale content.
- 2026-09-16: Import preserves the released `pod.json` and project bytes. It does not write ancestry into authored source or regenerate the released project, because either mutation would falsify the unchanged release identity.
- 2026-09-16: Host and native capture admit only the positive pod roots, reject linked directories before traversal, and share bounds of 200 files, 256 directories, 512 KiB per file, and 4 MiB total.
- 2026-09-16: Capture compares a root snapshot with the complete `release.json` file table before touching declared sibling workspaces. An exact released file set goes directly to native full release verification, so an installed sibling that is modified, invalid, or linked outside its root cannot block unchanged-release execution.
- 2026-09-16: `PreparedPod.ReleaseHash` is the authority for unchanged-release attribution. It equals the verified release content hash only when shipped bytes execute unchanged; derivatives return null and retain the old release in `Manifest.Parent`.
- 2026-09-16: Editing a release's human version creates a derivative without changing content identity by itself. Editing its pod id is permitted when the workspace directory identity changes with it; both preserve the exact old release as ancestry.

## Tried & rejected

- 2026-09-16: Accepting a partial Parameters Service collection after a later page fails; a truncated authority snapshot must fail retrieval.

- 2026-09-16: Runtime palette stacking; composition must be deterministic during preparation and publication.
- 2026-09-16: Bundled or cached Parameters Service definitions; inspection copies and releases are not authority fallbacks.
- 2026-09-16: Whole sibling-pod embedding; releases carry only source dependency documents actually consumed during composition.
- 2026-09-16: Automatic update or merge; adopting a newer dependency or ancestor remains an explicit edit.
- 2026-09-16: A universal JSON/script entrypoint abstraction; typed JSON does not become executable merely by appearing in a pod manifest.

## Owed

- 2026-09-16: Prove FF and Schedule execution plus Parameters Service resolution against a controlled Revit session and a real APS account; compile and deterministic tests cannot establish those runtime claims.
- 2026-09-16: Add Git or cloud transport only when a product workflow selects it; archive transport remains the implemented carrier.
