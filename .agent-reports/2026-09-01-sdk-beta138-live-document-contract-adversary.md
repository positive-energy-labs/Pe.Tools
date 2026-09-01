# SDK beta.138 live-document contract adversary

Date: 2026-09-01
SDK examined: `C:\Users\kaitp\source\repos\Pe.Revit.Sdk`, clean `ba5f58529cc1ff78c60fbc5ceecbac09ca72c805`
Consumer examined: `C:\Users\kaitp\source\repos\Pe.Tools`, read-only against its admitted dirty state
Proof boundary: source and deterministic-test census only. No Revit, browser, process, publish, release, commit, or product-source action was performed.

## Executive verdict

1. **`doc open` can and should activate an already-open saved document.** That is already the intended SDK contract, not a new capability: its bridge implementation uses `UIApplication.OpenAndActivateDocument`, and the close workflow explicitly calls the same API to reactivate an already-open saved swap document. The public description is under-specified because it says only “open”, and no deterministic test proves the already-open branch.
2. **Do not add `doc activate` as the minimal fix.** It would duplicate the existing saved-document behavior while still being unable to activate pathless documents. Pe.Tools already has an open-document inventory from `revit.context.document-session`; its picker simply discards it and offers active plus MRU documents. The smallest coherent contract is to make `doc open` explicitly idempotent for saved identities: activate if already open, otherwise preflight and open.
3. **Detached and never-saved documents are not equivalent to saved activatable documents.** A detached workshared document can inherit a central-path identity while having no `PathName`; an unsaved document has only a title plus an internal lifetime token. Revit activation in the existing proven seam takes a saved `PathName`, so neither identity should be advertised as activatable unless an actual non-empty `PathName` exists.
4. **Reject a local Revit-year mismatch inside the target-version bridge before the disk-open call.** First detect a saved document already open in this Revit and activate it without inspecting the source file. Only for a genuine disk open, call `BasicFileInfo.Extract(path)`, require `IsSavedInCurrentVersion`, and return a typed refusal containing `Format` and the running Revit version before registering the dialog audit or calling `OpenAndActivateDocument` / `OpenDocumentFile`.
5. **Do not release beta.138 as the live-document-failure fix.** Beta.138 is the regenerated contract cleanup, but it does not contain the year guard or a proved idempotent activation decision. Cut the behavioral correction as the next prerelease (recommended `0.1.0-beta.139`) and promote it only after deterministic, compile, and fresh Revit evidence.

## Authority and caller census

### Public command and generated client

- `source/Pe.Revit.Cli/VerbCatalog.cs:327-352` is the public verb authority. It declares `doc open`, `doc clone`, `doc close`, `doc current`, and `doc recents`; there is no `doc activate`. The `doc open` description is “open a local path, exact cloud identity, or cloud recent:<title> in one named Revit”.
- `source/Pe.Revit.Cli/ClientContractEmitter.cs:18-23,112-152` projects `VerbCatalog` and C# contracts into the TypeScript client.
- `clients/ts/generated/pe-revit-contract.ts:2,93-96,522,597-611` is beta.138 and exposes `docOpenArgv({ path, id?, detach?, conflictPolicy? })`. `DocOperationResult.response` remains `unknown`, so consumers cannot statically branch on `activated` or `mode`.
- `source/Pe.Revit.Cli/DocCommand.cs:128-149` resolves the positional argument as an existing local file, `cld://` identity, or `recent:<title>`, then posts `/doc/open`. A local path must exist before any session is contacted (`source/Pe.Revit.Cli/DocSelector.cs:16-35`).
- `source/Pe.Revit.Cli/DocCommand.cs:78-100` and `source/Pe.Revit.Cli/VerbCatalog.cs:346-349` expose the complete open-document set through `doc current`; saved paths, cloud GUIDs, activity, family state, and modified snapshot are represented by `DocumentInfo` (`source/Pe.Revit.Cli/Contracts/CoreContracts.cs:99-106,220-222`).

### Bridge runtime

- `source/Pe.Revit.Bridge/DocRoutes.cs:37-60` owns only `doc.open`, `doc.clone`, and `doc.close` mutation routes. `DocRequest` already carries local/cloud identity and detach policy.
- `source/Pe.Revit.Bridge/DocRoutes.cs:173-191` validates only target shape before dispatch. For local open it checks a nonblank path, but it has no file-version preflight.
- `source/Pe.Revit.Bridge/BridgeApplication.cs:359-401` is the Revit-bound implementation:
  - ordinary local and cloud requests call `UIApplication.OpenAndActivateDocument` and return `activated: true` with `mode: open-and-activate` or `open-cloud-and-activate`;
  - detached local requests call `Application.OpenDocumentFile` with `DetachAndPreserveWorksets` and return `activated: false`, `mode: open-detached`.
- `source/Pe.Revit.Bridge/BridgeApplication.cs:561-590` proves the intended saved-document activation seam independently of open: active-document close picks another open document only when its actual `Document.PathName` is non-empty, then calls `OpenAndActivateDocument(swap.PathName)`. Its comment explicitly says this is the same call `doc open` uses to reactivate an already-open document.
- `source/Pe.Revit.Bridge/BridgeApplication.cs:609-625` returns `title`, `path`, `mode`, `activated`, modification/family/worksharing/cloud facts, and reference census as an untyped JSON fragment.

### Identity authorities

- `source/Pe.Revit.Loader/Documents/DocumentKey.cs:5-40` defines the SDK identity priority: cloud project/model GUIDs, then document path, then `kind:unsaved:title:token`.
- `source/Pe.Revit.Loader/Documents/DocumentKey.cs:40-72` makes the central model path win for workshared documents, then cloud path, then `PathName`.
- `source/Pe.Revit.Loader/Documents/DocumentSelector.cs:6-55` selects among already-open documents by full path, then filename, then title. A pathless document is addressable by title only; collisions refuse rather than guessing.
- The status snapshot deliberately publishes the actual `Document.PathName`, not `DocumentKey.PathOf`, at `source/Pe.Revit.Bridge/BridgeApplication.cs:822-845`. This difference is load-bearing for detached documents.

### Pe.Tools callers

- `source/pe-tools/apps/host/src/session-route.ts:153-188,309-337` is a thin generated-client adapter. `/docs/open` requires `path` plus SDK session id and forwards `docOpenArgv`; it adds no activation semantics.
- `source/pe-tools/apps/web/src/targeting/world.ts:225-291` builds the picker from the active document plus Revit MRU entries. `pick` only finds a selection in the MRU list, calls `/docs/open`, checks `result.state === "ok"`, ignores `response.activated`/`mode`, and always says `opened <title>`.
- Pe.Tools already owns a richer live inventory: `revit.context.document-session` returns `activeDocument` and `openDocuments[]`, including `documentKey`, path, cloud GUIDs, and `isActive` (`source/pe-tools/packages/host-contracts/src/generated/host-ops.generated.ts:2267-2291`). Its implementation enumerates every open Revit document at `source/Pe.Revit.Global/Services/Host/RevitDataRequestService.cs:1600-1642`.
- The takeoff adapter throws away that inventory. `source/pe-tools/apps/web/src/takeoff/host.ts:141-152` reads only `activeDocument` and requires a cloud model GUID or path. Consequently an active unsaved document is unrepresentable, and an already-open inactive saved document is absent from the current picker unless it also appears in Revit MRU.

## Existing `doc open`: activate or open

The contract should be stated as **“make this saved local/cloud identity active in the named Revit: activate the existing document if it is already open; otherwise validate and open it.”**

That interpretation is consistent with all current runtime seams:

- the actual call is `OpenAndActivateDocument`, not `Application.OpenDocumentFile`, for ordinary opens;
- close already relies on that call to activate an already-open saved document;
- callers care about the selected active document, not whether a second `Document` wrapper was created;
- `OpenResultJson.activated` already expresses the relevant postcondition.

However, source intent is not live proof. `source/Pe.Revit.Loader.Tests/DocRoutesTests.cs:379-433` only source-inspects the close swap and confirms that pathless swap candidates are excluded. No test opens a saved document, opens another, calls `doc open` for the first path, and observes that the first becomes active without a second open instance.

The minimal implementation decision should be explicit before `BasicFileInfo` is introduced:

1. On the bridge API thread, compare a non-detached requested identity with the authoritative open set.
2. If the same saved document is already active, return success with `activated: true` and a precise mode such as `already-active`.
3. If it is open, inactive, and has an actual non-empty activatable `PathName`, activate it and return `activate-existing`.
4. Otherwise take the new-open branch: for local files run the version preflight, then use the existing open call.

This decision is not cosmetic. If a 2024-format model is already open in Revit 2025, its on-disk file may still report format 2024 until saved. Running the year check first would reject a harmless reactivation and regress the established contract.

## Detached and unsaved identities

### Ordinary saved local document

- Stable public identity: absolute path.
- Activatable: yes, through `OpenAndActivateDocument(path)`.
- Correct `doc open` behavior: activate existing or open-and-activate.

### Saved cloud document

- Stable SDK identity: project GUID plus model GUID; user-visible `cld://` paths are parsed by `DocSelector` (`source/Pe.Revit.Cli/DocSelector.cs:18-24,62-83`).
- Activatable: yes, through the cloud `ModelPath` overload and explicit conflict callback.
- Correct `doc open` behavior: identity-match and activate existing before applying new-open conflict behavior.

### Detached workshared document

- `doc open --detach` deliberately returns `activated: false` and uses non-activating `Application.OpenDocumentFile`.
- Its actual `Document.PathName` may be empty, so it is excluded from the known-working activation swap.
- At the same time, `DocumentKey.PathOf` prefers `GetWorksharingCentralModelPath`; therefore `OpenResultJson.path` can report the source central path and `DocumentKey.For` can produce `kind:path:<central>`, while the later `documents[]` status row reports the empty actual `PathName`.
- This creates a real identity hazard: a detached in-memory copy may look path-identified in one response, pathless in another, and can collide with the non-detached central document's key. A new verb accepting the projected central path would over-promise activation.
- Contract posture: detached remains an inactive, non-durable in-memory document. Do not claim it is activatable from its source/central identity. `doc clone` is the existing durable active-copy workflow (`docs/features/session/LEDGER.md:7`). If future runtime proof finds a detached document with a usable actual `PathName`, that exact capability can be admitted then; do not infer it from `DocumentKey.PathOf`.

### Never-saved document

- Internal identity: `kind:unsaved:title:token`; status contracts expose title and null path, not the stable tracked token.
- Read/close addressing: title is accepted when unique by `DocumentSelector`; ambiguity is a typed refusal. Tests cover this at `source/Pe.Revit.Loader.Tests/DocRoutesTests.cs:451-495`.
- Activation: the existing accepted Revit seam requires a path, and close explicitly refuses when all possible swap documents are unsaved (`source/Pe.Revit.Bridge/DocRoutes.cs:298-306`).
- Pe.Tools targeting: currently impossible because `activeDocument` requires a cloud GUID or absolute path.
- Contract posture: do not invent activation for unsaved documents. Surface them as visible-but-not-selectable, with a save-first explanation, or keep the current refusal. A document key is an identity, not proof of an activation mechanism.

## Why `doc activate` is not the minimal contract

Adding `doc activate --doc <selector>` initially looks attractive because `DocumentSelector` already selects from the open set. Under adversarial review it fails the minimality test:

- It duplicates `doc open` for every saved local/cloud identity.
- It still cannot activate pathless detached or unsaved documents through the only source-proven API seam.
- It forces callers to decide “open or activate” using a status snapshot that can become stale; the bridge must re-check anyway.
- Pe.Tools would need a new host route, generated client verb, result states, and picker branching even though it already has the live `openDocuments[]` inventory and `/docs/open` mutation route.
- It risks making `doc open` and `doc activate` disagree about identity, especially for detached central-path projections.

The smaller consumer correction is to include saved inactive rows from existing `revit.context.document-session.openDocuments` in `documentTrunk.feed`, then send their usable local path or complete cloud identity through the existing `doc open` route. Unsaved/pathless rows should be shown disabled or omitted with a reason. This report does not authorize that Pe.Tools edit.

An explicit activate verb becomes justified only if fresh Revit proof demonstrates a capability that `OpenAndActivateDocument(existing saved identity)` cannot serve—for example, a distinct supported API for pathless documents. Current source proves the opposite.

## Local Revit-year preflight

The correct authority is Autodesk Revit's `Autodesk.Revit.DB.BasicFileInfo`, available in the bridge's existing Revit API reference. It is explicitly designed to read basic Revit file data without opening the document:

- `BasicFileInfo.Extract(string)` accepts a full `.rvt`/`.rfa` path.
- `Format` is the saved major release string, such as `"2019"`.
- `IsSavedInCurrentVersion` says whether the file matches the running Revit.
- `IsSavedInLaterVersion` distinguishes a readable newer-format file.
- `Extract` can throw `InvalidOperationException` when a newer format changed the basic-info storage or a very old file has no basic data.

Local API evidence: `C:\Users\kaitp\.nuget\packages\nice3point.revit.api.revitapi\2025.4.41\ref\net8.0-windows7.0\RevitAPI.xml:86503-86531,86634-86662,86707-86720`.

Place the check in `BridgeApplication.OpenDocument`, on the target Revit's API-thread branch, **after existing-open matching and before dialog handler registration or any open API call**. The CLI project is plain `net8.0` and intentionally has no Revit API reference (`source/Pe.Revit.Cli/Pe.Revit.Cli.csproj:1-56`); adding a CLI-side Revit dependency or a custom file parser would be the wrong layer. The bridge already compiles against the correct Revit runtime bands (`source/Pe.Revit.Bridge/Pe.Revit.Bridge.csproj:7-8,24-27,57-60`).

Recommended local-new-open decision:

```text
existing exact saved target in Application.Documents?
  yes -> already-active / activate-existing; do not inspect the disk file
  no  -> BasicFileInfo.Extract(path)
         IsSavedInCurrentVersion -> existing open-and-activate/open-detached path
         IsSavedInLaterVersion   -> reject as later-version mismatch
         otherwise               -> reject as upgrade-required mismatch
         extraction indeterminate -> reject as unreadable/unknown-version, never fall through
```

Fail closed on an indeterminate `Extract`: falling through can surface the very modal upgrade/incompatibility UI the guard exists to prevent. Return a typed rejected response before registering `DialogBoxShowing`. The diagnostic should include at least:

- a stable code, e.g. `doc.revit-year-mismatch` (and optionally `doc.revit-version-unreadable` for indeterminate extraction);
- requested path;
- `fileFormat` when known;
- running Revit major version;
- whether the file is later or upgrade-required;
- a fix naming a matching-year session, not an instruction to dismiss a Revit dialog.

The guard is local-only. Cloud version/conflict behavior remains under Revit's cloud API and explicit conflict callback; do not pretend a filesystem preflight can cover it.

## Exact test gaps and required evidence

### Existing deterministic coverage

- `DocRoutesTests` covers request validation, detached request/result framing, durable receipts, selector behavior, close-route purity, source ordering, saved-path activation swap, and unsaved swap refusal (`source/Pe.Revit.Loader.Tests/DocRoutesTests.cs:23-49,60-100,379-495`).
- `ClientContractTests` checks generator provenance, absence of deleted document-result mirrors, verb-state authority, and committed generated-client drift (`source/Pe.Revit.Loader.Tests/ClientContractTests.cs:10-18,71-126`).
- No current source reference to `BasicFileInfo`, file format mismatch, or Model Upgrade exists in the bridge/tests.

### Add for the next prerelease

Deterministic / compile:

1. A pure decision test for exact saved target states: already active, open inactive with `PathName`, detached/pathless match, and not open.
2. Source/order or extracted-helper proof that existing-open activation precedes `BasicFileInfo`, and `BasicFileInfo` precedes dialog subscription and both open calls.
3. Version decision vectors: current, older/upgrade-required, later, and extraction-indeterminate. Every mismatch branch must be side-effect-free and typed `rejected`.
4. A detached identity vector pinning that central/source projection is not sufficient evidence of activatability; actual `PathName` is the gate.
5. Generator/contract proof if `DocOperationResult.response` is made concrete or new response modes/codes become public. Do not hand-maintain a Pe.Tools mirror.
6. Relevant bridge compile for both target frameworks plus the deterministic Loader.Tests harness. The current harness has only a narrow `--client-contract`; `DocRoutesTests` runs in the full deterministic suite (`source/Pe.Revit.Loader.Tests/Program.cs:60-99`).

Fresh Revit acceptance (required; unproved by this report):

1. Open saved A, open saved B, `doc open A`, observe A active, exactly two open documents, and response `activated:true` with activation mode.
2. Repeat `doc open` on already-active A; observe no duplicate and a truthful already-active result.
3. Open an older-year local file into a newer Revit when not already open; observe typed rejection, no Model Upgrade dialog, unchanged active document, unchanged open count, and a durable terminal receipt.
4. With that older file already open/upgraded in memory, activate another document and `doc open` the old path; observe reactivation succeeds without the disk-version rejection.
5. Open detached; prove `activated:false`, inspect `PathName`/central identity, and prove no command promises pathless activation.
6. Exercise a unique unsaved document and two same-title unsaved documents; prove readable/closable selector behavior remains intact and activation is explicitly unavailable.

Installed/product proof remains a separate lane after fresh behavior passes.

## Release recommendation

**Hold beta.138 as a contract-generation cleanup, not as the remedy for the live document failures.** Do not publish or advertise it as closing activation or Model Upgrade behavior.

Recommended next prerelease: **`0.1.0-beta.139`**, containing only:

1. explicit idempotent activate-or-open behavior inside existing `doc open` for saved local/cloud identities;
2. bridge-side local `BasicFileInfo` preflight on the genuine new-open branch;
3. truthful result mode/diagnostic contract and regenerated TypeScript client if the response becomes typed;
4. deterministic and dual-framework compile evidence;
5. fresh Revit acceptance for already-open activation, no-duplicate behavior, year mismatch with no modal/side effect, and detached/unsaved boundaries.

Pe.Tools should continue calling `doc open`; it does not need a new SDK verb. Its later consumer correction is to use its existing `openDocuments[]` inventory and respect the operation's activation result instead of always reporting “opened”.

## Proven versus owed

Proven from current source:

- ordinary `doc open` calls the activating Revit API;
- detached open is intentionally non-activating;
- saved-path activation is used by close swap;
- unsaved/pathless documents are excluded from that activation mechanism;
- Pe.Tools has an open-document inventory but its picker uses only active plus MRU;
- no local file-version preflight exists.

Owed because runtime action was prohibited:

- actual Revit behavior when `OpenAndActivateDocument` receives an already-open path/cloud identity;
- exact `PathName` and central-path behavior for each detached Revit year;
- proof that the proposed preflight prevents the Model Upgrade dialog and leaves session state untouched;
- cloud already-open activation behavior.
