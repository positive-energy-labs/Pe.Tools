# Portable Pods Ledger

## Decided

- 2026-09-16: A pod is one portable source/settings/assets boundary. Scripts declare entrypoints; typed JSON remains reusable data whose library owns operations and semantic validation.
- 2026-09-16: Identity has five separate facts: local folder address, manifest lineage id, exact content hash, parent release ancestry, and origin transport locator. Folder names do not define identity; ambiguous dependency selection names the conflicting folders.
- 2026-09-16: Users choose when to adopt updates. Human versions aid recognition and comparison without semver guarantees, automatic upgrades, merge machinery, or a native comparison UI.
- 2026-09-16: Normal import preserves a verified composed release and its authoring source. Explicit independent import makes composed JSON the editable settings source, retains original settings for inspection, and records the exact parent release. It does not flatten APS or code-package dependencies.
- 2026-09-16: Releases precompose source references and include consumed source documents for inspection. Runtime stacking and inspection-source fallback are forbidden. An unchanged release executes independently of installed authoring dependencies, including broken local siblings.
- 2026-09-16: Preparation captures inputs once. Batch members use the same snapshot; missing members cannot fall back to another settings root or newer snapshot. Edits require fresh preparation; composed-only tampering fails.
- 2026-09-16: APS is the sole authority for parameter definitions. The consuming library resolves and validates only resources used by its operation; unrelated members must not impose execution gates. Failed pagination cannot return a partial authority snapshot.
- 2026-09-16: Documents/Pe.Tools holds preferences.json and Pods/<local folder>. Hard replace the previous settings hierarchy with no compatibility or migration code; the user will handle existing local files manually. Cache, credentials, installed binaries, and transient state live elsewhere.
- 2026-09-16: Useful output files and a receipt share a unique run folder under the pod's excluded output directory. Attribution records snapshot, member, actual operation, outcome, and output references. No automatic archival of every return value or tracking of objects moved between Revit projects is required.
- 2026-09-16: Pea's bundled build-pod guidance and generated pod guidance teach these identity and authoring rules. Product guidance must not depend on repo history.

- 2026-09-16: Editor previews delegate captured draft bytes to the same native preparation service as execution. A declared `$schema` selects library validation independently of the local Pod folder; it does not bind an operation. Generic JSON without that declaration has no library validator selected.

## Tried & rejected

- 2026-09-16: Binding library operations to authored JSON manifest entries; this makes reusable data look executable.
- 2026-09-16: Whole sibling-pod embedding and bundled/cached APS authority; publish consumed source for inspection and retrieve current external authority at execution.
- 2026-09-16: Equating a folder name with lineage identity; an Explorer rename must not invalidate a pod.
- 2026-09-16: Import-time mutation of released project or manifest bytes; ordinary import must retain the exact released content.

## Owed

- Prove actual Family Foundry and Schedule operations with current APS resolution in a controlled checkout session; constructor, deterministic, and compile checks do not prove this workflow.
- Replace the preparation result placeholder manifest with an explicit rejected/prepared result before claiming the state model complete.
- Editor composition uses native preparation; offline authored JSON stays editable but directive previews require that service.
- Add Git/cloud transport only when its concrete workflow is selected; archive transport is the present carrier.
