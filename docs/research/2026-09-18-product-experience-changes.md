# How the product experience changed

Comparison: `d9783288346c4340926a64dfa93c35a728b99a5a`, immediately before the requested range, to `5568e31eda9bec298db21bb53f7ccdcb22ceaefc`, the completed 17-commit reconstruction. This compares the changes collected by the squash; squashing itself did not redesign the product.

This is a historical source comparison, not a browser or native-runtime certification. “Now” means the frozen reconstructed endpoint. The September 18 draft-first ruling appears separately because it is newer than that endpoint. Existing ledgers contain intended behavior and stale Owed entries; source determines whether a flow actually exists.

## The overall change

The product moves from separate tool workspaces, feature-specific profiles, and script Pods toward a document-centered workbench: inspect the document, author changes with Pea, review them, execute them, and keep reusable source in a Pod.

The old product already had proposals, staged edits, shared route state, script packages, and document targeting. The change is their consolidation and wider use, not their invention. The largest unfinished part is whether the thing the user sees and edits is consistently the thing an operation consumes.

## 1. A Pod becomes a home for reusable work, beyond runnable scripts

**Before.** Pods were script workspaces with declared entrypoints. Users or Pea could bootstrap them, run an entrypoint, and import/export them. Family and other settings profiles lived in a separate feature/module hierarchy, browsed through `/settings` and feature-specific pickers. There was no standalone `/pods` page at the baseline.

**Now.** A Pod can contain scripts, typed JSON members, reusable fragments, and assets. A JSON-only Pod needs no script entrypoint. `/pods` lets the user browse members, open a shared form/raw editor, inspect member-associated runs, and follow a member into the relevant product route. Family and Schedule routes can work with those same members in place.

**Why.** Reusable standards and captured document definitions should be ordinary material the user can inspect, edit, share, and reuse. They should not require a custom settings module or a script wrapper merely to exist.

**What changes for the user.** “Find the profile under the right tool's settings” becomes “open this member in my Pod, then use it with the appropriate tool.” A member's schema identifies its meaning; its filename need not follow a special suffix convention.

**Still incomplete.** Human import/export controls are not evident on the new Pods page; those capabilities remain available through Pea/CLI. Browsing Pods also still passes through document-oriented route machinery. The new organization is ahead of the first-run and disconnected-editing experience.

## 2. Sharing a standard is meant to carry its ingredients with it

**Before.** Pod archives existed, but Pods centered on script workspaces; reusable feature profiles were managed separately. The baseline validator also tied manifest identity to the workspace name.

**Now.** Folder address, declared Pod identity, and content are distinct. Local standards can compose reusable fragments. Export copies the foreign fragments actually consumed and rewrites their references, so the recipient can compose the exported Pod without installing the sender's sibling Pods. Composition remains editable rather than being flattened into one opaque result.

**Why.** A designer should be able to share a useful standard without sharing their whole machine's directory structure. Renaming a folder should not rename the Pod's identity. One malformed member should not make all the useful members disappear.

**Important historical distinction.** The elaborate release/dependency-hash model was an intermediate experiment inside this range, then rejected. It was not the starting product. The end-to-end comparison is script-package portability becoming source-and-standard portability.

## 3. Family work moves toward reading the live family first

**Before.** `/family` centered on an authored profile, with a parameter/type table, anatomy, proposals, and live/saved comparisons. It already had considerable interaction design. Building an RFA read saved source; some editing/apply behavior was page-local or explicitly unfinished. `/families` separately selected a profile and scope for bulk plan/apply.

**Now.** `/family` can read the targeted family into a live draft without first selecting a saved Pod member. A saved member can be opened into that work. The route supports proposal review, capture/save into a Pod, planning, applying, and building an RFA from saved source. The family engine increasingly interprets a desired family state and reconciles it against the native family.

**Why.** Users should be able to start with the family they actually have. Editing, reusable standards, and native application should be parts of one task rather than separate worlds the user manually reconciles.

**Still incomplete.** The endpoint mixes draft and saved-member rules. Planning accepted draft proposals files a new member before planning it. The capture action can mean either reading Revit into a member or saving an existing draft. The shared editor can also show unsaved text while the operation reads saved bytes. These are meaningful UX contradictions, not merely naming debt.

## 4. Pea and the human move toward editing the same work

**Before.** Pea already proposed edits into route documents, and users could review them in feature-specific views. Different tools had their own stores, proposal forms, and local editing state; some live edits were not accessible through the same collaboration path.

**Now.** The intended unit is thread-owned work. Pea can propose into a draft independently of whether its full route is open. The user should encounter the same proposals in Chat and in the detailed workspace. Routes and agent operations increasingly share action admission and refusal rules.

**Why.** “Ask Pea to change this” should produce reviewable work, not a second private version that the user must manually copy into the tool. Opening the detailed view should reveal more of the same task.

**Still incomplete.** Family draft proposals and member-editor proposals still have different shapes and acceptance paths. Private editor text is another state layer. The Family Chat projection is still substantially a link to the route rather than the complete shared proposal experience. This is a partially implemented product direction.

## 5. The conversation becomes the context for the document

**Before.** A standalone page could take its document/session from its own URL or inherit scope from a Chat thread. A page without either asked the user to select a document in Chat or Instances. Route-local bindings and thread scope both participated in the experience.

**Now.** The recorded direction is one canonical document binding per thread, shared by Chat and product routes; a second document belongs in a second thread. A URL target is a view pin rather than another persistent owner. Execution also distinguishes the particular open document lifetime from a remembered file address.

**Why.** The user should not have to repeatedly answer “which document does this mean?” or discover that Pea and the visible tool are aimed at different things. Closing and reopening a file must not silently make old queued work valid against the new open instance.

**Still incomplete.** Recon found races in scope updates and late action completion paths that can overwrite newer member navigation. The intended coherence is stronger than the endpoint's guarantees.

## 6. Schedules gain two distinct kinds of work

**Before.** `/schedule-grid` focused on inspecting a schedule and staging/pushing cell edits.

**Now.** `/schedules` retains cell editing and adds capture/apply of a reusable schedule definition through Pod members. These are separate operations: pushing changes cell values; definition apply creates a schedule. Capturing the definition does not capture its cell values.

**Why.** A reusable schedule standard and edits to this project's schedule data are both useful, but they are not interchangeable. The new product connects the standard to Pods while retaining the direct grid workflow.

**Risk to avoid.** A generic “apply” journey must not erase that distinction or imply a definition apply merely saves grid edits.

## 7. Execution becomes something the user can inspect and recover

**Before.** Individual features and script tools already returned receipts and had some unknown-outcome handling. Recovery and confirmation were tied more closely to each feature's implementation.

**Now.** Shared action records retain the admitted request, target, preparation, steps, and outcome. Recover and resume are distinct, and uncertainty is not supposed to trigger blind replay. Cancellation is carried through the host and bridge toward the actual native operation. Pod runs gain attribution to the member/source used.

**Why.** A disconnected UI or lost response should not leave the user guessing whether to press Apply again. Stop should reach the operation, and a run should explain what it touched and consumed.

**Still incomplete.** Recovery controls exist but are not mounted consistently on Family routes. Source recon found cancelled native receipts that can remain unknown after recovery, and successful transport responses that can contain unsuccessful domain outcomes. Hashes and paths also do not establish that actual input bytes remain in the output set; that is now being checked explicitly.

## 8. Chat continuity improves; Takeoffs changes are less of a new journey

**Chat before and now.** Chat already had threads, views, attachments, route plugins, and proposals. The new transcript implementation aims to make those one coherent conversation: one scroll intent, composers retained separately for visited threads, and deferred results looked up against the correct thread. The user benefit is less lost context when moving around, not the replacement of a rendering dependency. Retained composers are not a guarantee that drafts survive reload or leaving Chat.

**Takeoffs before and now.** Adoption, partitioning, review, and sync already existed at the baseline; so did vector/Space work. It would be misleading to call this range the first move from raster to vector. This range reorganizes the geometry and strengthens ownership of edits, observations, and publication. The product promise is that designer choices survive refresh/rerun and that accepted, held, and uncertain results stay distinguishable. Much of this is reliability beneath an existing journey rather than a newly invented workflow.

## New ruling after the comparison endpoint

On September 18 the user settled the central unfinished choice: **Plan and Apply consume the reviewed draft; saving to a Pod is separate.** A synthetic or temporary member is acceptable internally if it simplifies execution. The consumed input must always be included in the output set.

That makes the intended journey: **inspect live work → edit or ask Pea → review → apply**, with **save for reuse** available separately. This is the approved next direction, not a claim that the squashed endpoint already does it correctly.

## Evidence anchors

Inspect historical files with `git show <commit>:<path>`. Baseline is `d978328`; endpoint is `5568e31`. Paths below are source anchors, not claims of runtime proof.

| Topic | Baseline anchor | Endpoint anchor |
| --- | --- | --- |
| Script Pods versus reusable members | `dotnet/Pe.Shared.Scripting/Pods/PodManifest.cs`; `ts/packages/mcps/src/pea/pods-commands.ts`; `ts/apps/web/src/routes/settings.tsx` | `ts/apps/web/src/routes/pods.tsx`; `ts/apps/web/src/route/spec-editor.tsx` |
| Portable composition | `dotnet/Pe.Revit.Scripting/Pods/ScriptPodArchiveService.cs` | Same path, `Vendor`; `docs/features/pods/LEDGER.md` for decisions and rejected intermediate designs |
| Family authoring | `ts/apps/web/src/family/workspace.tsx`; `ts/apps/web/src/families/workspace.tsx` | `ts/apps/web/src/route/family/live.tsx`; `ts/apps/web/src/route/family/manifest.ts`, especially `captureInput` and `staged` |
| Document context | `ts/apps/web/src/workbench/route-scope.tsx` | `ts/packages/runtime/src/scope-store.ts`; `ts/apps/web/src/route/use-route.ts` |
| Schedule workflows | `ts/apps/web/src/routes/schedule-grid.tsx` | `ts/apps/web/src/route/schedules/live.tsx`; `ts/apps/web/src/route/schedules/manifest.ts` |
| Recovery and cancellation | Feature-specific stores and `pods-commands.ts` | `ts/apps/host/src/action-journal.ts`; `native-receipts.ts`; `ts/apps/web/src/actions/receipt.tsx` |
| Chat continuity | `ts/apps/web/src/routes/chat.tsx`; `workbench/aui.tsx` | `ts/apps/web/src/chat/composer-bank.tsx`; `workbench/deferred-result.ts`; `workbench/lens/thread-body.tsx` |
| Existing Takeoffs journey | `ts/apps/web/src/takeoff/store.ts`; `dotnet/Pe.Revit.Space/Partition.cs` | `ts/apps/web/src/takeoff/actions.ts`; `docs/features/takeoffs/LEDGER.md` |
