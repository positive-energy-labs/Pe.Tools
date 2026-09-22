# Chat runtime cutover contract

## Scope and verified baseline

This contract covers the minimum source cutover for per-thread composer drafts under React 19 Activity. It does not change server persistence, add a TTL, retain transcript DOM, or implement the cutover.

Current source has one chat store per keyed `WorkbenchProvider`. The route keys that provider by the selected thread, so a thread switch unmounts the provider and its store (`source/pe-tools/apps/web/src/routes/chat.tsx:53-65`). `createChatPageStore` owns one draft atom, and that atom contains prompt text plus attachments (`source/pe-tools/apps/web/src/workbench/store.ts:8-22`, `source/pe-tools/apps/web/src/workbench/store.ts:84-90`). `Composer`, `useSend`, and `WorkbenchProvider.sendPrompt` all read or mutate that same atom (`source/pe-tools/apps/web/src/chat/composer.tsx:42-59`, `source/pe-tools/apps/web/src/chat/composer-head.tsx:36-54`, `source/pe-tools/apps/web/src/workbench/provider/view.tsx:109-133`).

The route-owner census remains correct for an Activity boundary around a route owner: `useRouteOwner` disposes from effect cleanup, so Activity hide permanently releases its retained owner (`source/pe-tools/apps/web/src/route/use-route.ts:277-290`). This cutover does not place `WorkbenchProvider`, `createChatPageStore`, or `useRoute` inside the composer Activity bank. Those owners stay mounted above it.

## Two concrete shapes

| Shape | Actual edit | Cost and failure boundary | Verdict |
|---|---|---|---|
| React-local draft per retained thread | Remove the draft atom. `ChatShell` keeps a session-local set of visited thread IDs and renders one lightweight composer subtree per ID under `<Activity mode={id === currentThreadId ? "visible" : "hidden"}>`. Each subtree owns `useState<ChatDraft>`. | Changes the draft consumers listed below. React owns retention. Hidden composers keep text and attachment bytes, but not the Lens, transcript, thread stream, route owner, panes, or sidebar. No second cache, TTL, or persistence exists. | **Recommended.** It matches the requested Activity model and gives completion a natural originating component. |
| Atom map above Activity | Replace `draft` with `drafts: Atom<Map<threadId, ChatDraft>>`; every consumer supplies a thread ID. | Similar consumer edits, plus map mutation, deletion policy, atom inspection of the whole map, and a second lifetime model beside Activity. Activity is then unnecessary for draft retention. | **Reject for this cutover.** It duplicates the ownership job that Activity was selected to do. |

## Recommended ownership

### Workbench and shared chrome

`WorkbenchProvider` remains one unkeyed owner for the `/chat` route. Remove `key={thread ?? "draft"}` from `ChatRouteContent`; the provider derives `currentThreadId` from search as it does now (`source/pe-tools/apps/web/src/workbench/provider/view.tsx:28-50`). Thread switching must not recreate the shared store.

`createChatPageStore` remains the owner of genuinely shared page mechanics:

- palette open state;
- mutually exclusive side/plugin pane selection;
- World presentation preferences: `density` and `diff`;
- route-owner busy, failure, conflict, and log state.

Pane selection and palette state contain no message identity (`source/pe-tools/apps/web/src/workbench/store.ts:51-57`). Keep them singleton above Activity. Do not copy them into each thread composer.

The current store also mixes thread identity into singleton atoms. `lensInspectKey` and `lensPinKey` name tool cells; `lensIntent` names a turn; `worldCache` holds the previous signatures and turn count used for the diff baseline (`source/pe-tools/apps/web/src/workbench/store.ts:58-82`, `source/pe-tools/apps/web/src/workbench/world/cap.tsx:25-45`). `world.openItems` can also name items derived from one thread. The comment in `useLensModel` confirms the current provider key resets this state on every thread switch (`source/pe-tools/apps/web/src/workbench/lens/model.ts:88-99`).

Preserve that reset behavior. Do not retain a per-thread `threadView` map. Split the store into:

- one unkeyed shared owner for palette state, side/plugin selection, World `density` and `diff`, and route-owner state;
- one `CurrentThreadViewOwner`, keyed by `currentThreadId` and mounted outside the composer Activity bank, for `lensInspectKey`, `lensPinKey`, `lensIntent`, `lensFollowing`, World `open` / `openItems`, and `worldCache`.

Thread selection unmounts and disposes the old current-thread owner, then creates an empty owner for the new thread with only that navigation's optional `turn` seed. This matches today's behavior and retains no prior lens or World state. The owner may use the existing atom shapes so `Lens`, `useCacheView`, and `SessionStrip` need only read the current-thread owner instead of the shared store. Because this keyed owner is outside Activity, its effect cleanup is a true unmount; the Activity disposal problem does not apply.

SidePane width has separate custody. `SidePane` owns width in React state and persists it under the supplied `localStorage` key (`source/pe-tools/apps/web/src/components/lang/side-pane.tsx:59-116`). The left conversation pane uses its existing `pe.sideWidth` custody through `Lens`, and the plugin pane uses `pe.pluginWidth` (`source/pe-tools/apps/web/src/chat/chat-shell.tsx:82-95`, `source/pe-tools/apps/web/src/chat/chat-shell.tsx:210-234`). Keep both panes outside the per-thread Activity bank. The cutover must not add width fields to `ChatDraft`.

### Per-thread composer

`source/pe-tools/apps/web/src/chat/chat-shell.tsx` owns the visited-thread list because it knows `currentThreadId` and draws the composer lane. Add the current ID once, retain each ID until the chat route unmounts, and remove an ID when that thread is deleted. Do not use the full server thread list as the bank because unopened threads need no React state.

Each visited ID gets one Activity child that contains only a new `ThreadComposer` boundary and the existing composer/head UI. The Lens at `chat-shell.tsx:169-188`, route shell, thread body, thread list, plugin pane, and palette remain outside. This rule prevents draft retention from retaining the multi-megabyte transcript DOM.

`ThreadComposer` belongs in `source/pe-tools/apps/web/src/chat/composer.tsx`; a new UI file adds no useful boundary. The neutral value contract moves to `source/pe-tools/apps/web/src/workbench/prompt.ts`, which contains `WorkbenchAttachment` and `ChatDraft` only. `workbench/actions.ts` imports those types and keeps `PromptInput`. No provider or action module imports the UI composer. `ThreadComposer` owns:

- `useState<ChatDraft>` for text and attachments;
- composer-only UI state already held by `Composer`, such as drag state, refusal, and slash-menu selection;
- settlement of the exact draft object submitted by that component.

Make `Composer` controlled by `draft` and `setDraft`. Compute the Send handle once for that composer and pass it to both `Composer` and `ComposerHead`; neither component may read a draft from `useWorkbench().store`. `Composer` still receives the route handle for New, Fork, and Cancel.

### Completion custody after a thread switch

`WorkbenchProvider.sendPrompt` sends bytes only. Delete its reads of `store.atoms.draft`, its `ownsDraft` comparison, and its call to `clearDraftIfUnchanged` (`source/pe-tools/apps/web/src/workbench/provider/view.tsx:109-133`).

The originating `ThreadComposer` captures the submitted draft object. After Send succeeds, it runs the equivalent of:

```ts
setDraft((current) => (current === submitted ? EMPTY_CHAT_DRAFT : current));
```

The state setter belongs to the originating Activity child. If the user switches threads before completion, the hidden origin clears and the newly visible thread is untouched. If the user edits the origin while Send is pending, object identity prevents the completion from clearing the newer draft. A refusal or thrown send keeps the submitted draft.

The route action remains the only Send verb. `useSend` still wraps `handle.actions.send`, but it receives the controlled draft and the origin settlement callback. Do not create a second send path.

### Attachment lifetime

Current image attachments store both base64 data and a blob URL preview (`source/pe-tools/apps/web/src/chat/composer.tsx:356-376`). A composer effect revokes previews when a chip disappears, but it deliberately does not revoke all previews on unmount (`source/pe-tools/apps/web/src/chat/composer.tsx:70-79`). Activity also cleans effects on hide, so effect-cleanup disposal cannot distinguish hide from final removal.

Delete blob URL custody instead of adding another lifecycle protocol:

- delete `WorkbenchAttachment.preview`;
- delete `URL.createObjectURL(file)` in `readAttachment`;
- delete the `previews` ref and revocation effect;
- render an image chip from the already-held `data` plus `mimeType`, using the existing data-URL rule in `imageSource` or the same one-line construction.

Then removing, sending, deleting a retained thread, or leaving chat drops ordinary React data with no external URL to revoke. Attachment bytes remain only in that thread's retained draft. No attachment is serialized to URL or another store.

### Thread body, shell coherence, and stream

The retained composer must not own the thread body request. Today `useThreadStream` uses `useHostCall` plus React state for the current body, display frame, optimistic sent rows, and stream fault (`source/pe-tools/apps/web/src/workbench/provider/thread-stream.ts:34-64`, `source/pe-tools/apps/web/src/workbench/provider/thread-stream.ts:127-143`).

Cut the persisted body into an `AsyncResult<ChatState>` atom keyed by `origin` and `threadId` in `source/pe-tools/apps/web/src/workbench/provider/thread-stream.ts`. Do not call `useAtomSuspense` in `WorkbenchProvider` or `ChatShell`; either would suspend the provider or the whole shell.

`WorkbenchProvider` continues to own the current session and SSE subscription. It exposes the live `display` frame separately from the body because approvals and run status are stream facts (`source/pe-tools/apps/web/src/workbench/provider/thread-stream.ts:76-125`, `source/pe-tools/apps/web/src/workbench/chat-state.ts:387-418`). It also reads the keyed body atom without suspense as an `AsyncResult`. A success produces the current shell projection by merging stored messages, optimistic sent rows, and the current display exactly as `useThreadStream` does now (`source/pe-tools/apps/web/src/workbench/provider/thread-stream.ts:127-133`). Pending B must never reuse successful A.

Split the current `Lens` composition at `source/pe-tools/apps/web/src/workbench/lens/view.tsx:66-203`:

- `LensFrame` keeps the left `SidePane`, mode dial, thread list, and layout mounted.
- `ThreadBody` owns the dial bands, context strip, moments, route plug-in dock, and scrim. Only this component calls `useAtomSuspense(bodyAtom(origin, currentThreadId))`, inside a boundary whose fallback occupies the center lane.
- Trace and World sidebar content reads the non-suspending successful projection for the same current thread. While its body is pending, the pane stays open and shows a thread-scoped loading placeholder. Threads mode keeps the thread list fully usable.

The shell derives each non-body value from the same current-thread key:

- `chatManifest.display`, `selectApprovals`, Send/Cancel readiness, and `isRunning` use the live display frame, so the composer head remains usable before the body resolves (`source/pe-tools/apps/web/src/chat/chat-shell.tsx:54-79`, `source/pe-tools/apps/web/src/chat/composer-head.tsx:73-100`, `source/pe-tools/apps/web/src/chat/composer-head.tsx:124`).
- `hasMessages` uses the successful current body only. While pending, Fork is unavailable instead of borrowing the prior thread's count (`source/pe-tools/apps/web/src/chat/manifest.ts:101-112`).
- `breakdown`, `userTurns`, ContextRibbon, World content, and cache baseline use the successful current projection only (`source/pe-tools/apps/web/src/chat/chat-shell.tsx:97-104`). While pending, the ribbon reports loading/absent for that thread; it does not suspend the composer.
- route head and inventory continue through `useRoute` Readings, outside the body boundary, so target controls stay live.

The ownership rules are strict:

- the active body/Lens reads the body atom;
- a hidden `ThreadComposer` never reads the body atom and never renders `Lens`;
- the body atom does not contain draft or attachment state;
- the composer Activity bank does not retain body data or transcript DOM;
- a pending body exposes no message-derived facts from the previously selected thread;
- this cutover adds no TTL, browser persistence, or server persistence.

This body change is independent of draft retention. It may land in the same cutover, but the APIs must stay separate so a body refetch cannot reset a draft and an Activity hide cannot abort or dispose the active body owner.

## Inspector contract

`OwnerReferences` accepts only `Atom.Atom<unknown>` entries (`source/pe-tools/apps/web/src/state/atom-inspect.ts:1-6`). The inspector reads cached atom nodes without mounting or subscribing (`source/pe-tools/apps/web/src/state/atom-inspect.ts:43-48`, `source/pe-tools/apps/web/src/state/atom-inspect.ts:82-96`). React-local drafts therefore cannot appear in `OwnerReferences` without widening the inspector into a second state adapter.

Removing draft inspection costs one deleted reference but loses the only owner-level view of the current prompt. That reduction is not accepted.

The minimum read-only extension changes two infrastructure files and one composer registration site. Estimated source delta is 25-40 lines, with no mirrored atom:

- In `state/atom-inspect.ts`, define a snapshot leaf `{ label: string; read: () => unknown }` beside `Atom.Atom<unknown>`. `OwnerReferences` accepts either. `inspect()` calls `read()` only when requested and serializes it through the existing `show`; snapshot leaves have no graph parents or children. Existing atom handling remains unchanged (`source/pe-tools/apps/web/src/state/atom-inspect.ts:4-6`, `source/pe-tools/apps/web/src/state/atom-inspect.ts:43-48`, `source/pe-tools/apps/web/src/state/atom-inspect.ts:82-96`).
- In `route/use-route.ts`, make `expose` attach publication listeners only for atom leaves. Snapshot leaves register metadata but never mount, subscribe, or enter `registry.getNodes()` (`source/pe-tools/apps/web/src/route/use-route.ts:223-240`). Return a small `notifyInspection` callback from the owner.
- In `chat/composer.tsx`, the visible `ThreadComposer` exposes `{ page: { draft: { label: `chat/${threadId}/draft`, read: () => draftRef.current } } }` and calls `notifyInspection` after a draft change. The closure reads React state through a ref; it does not copy state into an atom. Activity cleanup may unregister a hidden composer because the inspector promises the visible owner snapshot, not an archive of hidden drafts; reveal registers it again.

This extension preserves current visible-draft observability. It does not expose attachment bytes by default: the snapshot returns text plus attachment name, MIME type, and size, so opening the inspector cannot duplicate or stringify multi-megabyte base64 payloads.

## Required file edits

| File | Required change |
|---|---|
| `source/pe-tools/apps/web/src/routes/chat.tsx` | Remove the thread key from `WorkbenchProvider`. Keep `prompt` as an incoming seed. Strip `prompt` and `turn` whenever navigation changes `thread`. Update the URL-state comment to say drafts never write URL state. |
| `source/pe-tools/apps/web/src/chat/chat-shell.tsx` | Own visited draft IDs; render the composer-only Activity bank; mount one `CurrentThreadViewOwner key={currentThreadId}` outside Activity; keep panes and palette outside; place Suspense around `ThreadBody` only; remove a retained composer after successful deletion. |
| `source/pe-tools/apps/web/src/chat/composer.tsx` | Add `ThreadComposer`; make `Composer` controlled; give completion to the origin; remove blob URLs and preview cleanup; register a sanitized read-only draft snapshot. Import the draft contract from `workbench/prompt.ts`. |
| `source/pe-tools/apps/web/src/chat/composer-head.tsx` | Stop reading `store.atoms.draft`; accept the already-scoped Send handle or controlled draft contract from `ThreadComposer`. |
| `source/pe-tools/apps/web/src/workbench/store.ts` | Delete draft ownership and URL prompt timer. Keep shared pane/palette and World presentation atoms. Extract message-bound lens/World atoms into the disposable current-thread view owner; do not add a retained map. |
| `source/pe-tools/apps/web/src/workbench/provider/view.tsx` | Remove draft lookup/clearing from `sendPrompt`; keep transport, errors, invalidation, sessions, and thread verbs. Ensure delete notifies the shell to remove that retained composer entry. |
| `source/pe-tools/apps/web/src/workbench/provider/thread-stream.ts` | Replace the body `useHostCall` with a keyed AsyncResult atom. Expose live display separately. Provide a non-suspending current projection for shell facts; export the body atom for `ThreadBody.useAtomSuspense`. |
| `source/pe-tools/apps/web/src/workbench/lens/view.tsx` | Split persistent pane/layout chrome from the body that suspends. Keep thread-list sidebar interactive while a body loads; show keyed loading content in trace/world panes. |
| `source/pe-tools/apps/web/src/workbench/provider/thread-summary.tsx` | Import/re-export `WorkbenchAttachment` from `workbench/prompt.ts`; expose live display/body result separately; adjust delete completion so the shell removes retained entries only after success. |
| `source/pe-tools/apps/web/src/workbench/provider/use-workbench.tsx` | Import `WorkbenchAttachment` from `workbench/prompt.ts`. `toFiles` remains unchanged. |
| `source/pe-tools/apps/web/src/workbench/provider.tsx` | Re-export the neutral action-contract type through the existing provider surface. |
| `source/pe-tools/apps/web/src/workbench/prompt.ts` | New leaf type-only home for `WorkbenchAttachment` and `ChatDraft`. It imports no provider, store, action, or UI module. |
| `source/pe-tools/apps/web/src/workbench/actions.ts` | Import `WorkbenchAttachment` from `workbench/prompt.ts`; keep `PromptInput` and Send behavior here. It must not import UI composer code. |
| `source/pe-tools/apps/web/src/state/atom-inspect.ts` | Add the read-only snapshot leaf described above; do not add a draft atom. |
| `source/pe-tools/apps/web/src/route/use-route.ts` | Let owner inspection register snapshot leaves without mounting them; expose inspection notification. Do not change route-owner disposal in this cutover. |
| `source/pe-tools/apps/web/src/chat/seeds.ts` | Delete or rewrite the stale statement that the draft belongs to `createChatPageStore` (`source/pe-tools/apps/web/src/chat/seeds.ts:324`). |

No other production source currently reads `store.atoms.draft`, `setDraft`, or `clearDraftIfUnchanged`. The remaining store consumers stay outside the composer boundary. Pane/palette consumers use the shared owner, while lens and World consumers read the keyed current-thread owner (`source/pe-tools/apps/web/src/chat/chat-shell.tsx:82-93`, `source/pe-tools/apps/web/src/workbench/lens/model.ts:88-99`, `source/pe-tools/apps/web/src/workbench/world/cap.tsx:25-45`, `source/pe-tools/apps/web/src/workbench/world/lane.tsx:46-75`).

## Deletion targets

Delete from `source/pe-tools/apps/web/src/workbench/store.ts`:

- `WorkbenchAttachment` and `ChatDraft` after moving them to `workbench/prompt.ts`;
- the `draft` atom;
- `promptTimer`;
- `setDraft` and `clearDraftIfUnchanged`;
- draft from `atoms` and `core.expose`;
- prompt-write cleanup in `dispose`.

Delete from `source/pe-tools/apps/web/src/chat/composer.tsx`:

- `useAtomValue(store.atoms.draft)` and draft store mutations;
- `preview` URL creation;
- the preview-revocation ref/effect and its ponytail comment.

Delete from `source/pe-tools/apps/web/src/workbench/provider/view.tsx` the `sentDraft` / `ownsDraft` / provider-side clearing block. Delete the keyed provider remount in `routes/chat.tsx`.

Do not delete `createChatPageStore`, `useRouteOwner`, shared pane/palette atoms, shared World presentation atoms, SidePane localStorage widths, or the route Send action. Move the message-bound lens and World cache atoms into the keyed current-thread owner; do not retain their old values.

## Tests that change

- `source/pe-tools/apps/web/src/workbench/store.test.ts`: delete the draft-label and draft-settlement cases; retain shared pane coverage and prove that replacing the keyed current-thread owner resets lens intent, pin, and World baseline.
- `source/pe-tools/apps/web/src/chat/composer.test.tsx`: stop constructing draft state through `createChatPageStore`; mount a controlled or `ThreadComposer` draft. Replace blob URL assertions with data-URL/no-object-URL assertions. Add one check that a hidden origin completes without clearing the visible thread and one check that an edited origin is not cleared.
- Add a focused Activity check beside `composer.test.tsx`: switch A to B to A and prove A's text and attachment remain while only the active Lens exists.
- Add a focused body-atom check beside `thread-stream.ts`: `useAtomSuspense` resolves the selected thread body and invalidation replaces it without touching a composer draft.

`diagram-call.test.tsx`, `tool-images.test.tsx`, and `workbench/lens/model.test.tsx` construct `createChatPageStore` but do not consume its draft API. They need only fixture/type adjustments if the store return type narrows; their behavior assertions do not change.

## URL draft verdict

Drafts stay with their thread. The URL remains an input door only. `?prompt=` seeds the first `ThreadComposer` for the thread selected by that navigation, once. No draft change writes `prompt` back to the URL.

Every navigation that changes `thread` removes both `prompt` and `turn` in the same search patch. This applies to thread-list selection, New, Fork completion, delete-current fallback, and any shared `openThread` helper (`source/pe-tools/apps/web/src/workbench/store.ts:165-168`, `source/pe-tools/apps/web/src/workbench/provider/view.tsx:98-100`, `source/pe-tools/apps/web/src/workbench/provider/view.tsx:143-160`, `source/pe-tools/apps/web/src/workbench/provider/view.tsx:177-189`). A hidden composer has no URL callback, so it cannot write the current thread's search state.

## Cutover contract

1. Activity retains composer state only; it never retains Lens, transcript DOM, body data, route owners, panes, or sidebar.
2. Pane layout and World presentation remain shared; one keyed current-thread owner resets message-bound lens state and World baselines on selection.
3. The originating per-thread composer owns successful-send clearing, including completion after a switch.
4. Attachment previews use held bytes, so hide and final removal require no effect-based resource cleanup.
5. Only `ThreadBody` suspends on the selected thread's AsyncResult; shell display, approvals, composer, route head, and thread sidebar remain coherent and usable.
