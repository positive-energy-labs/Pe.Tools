# Chat runtime checkpoint review

A bounded, independent review done on 2026-09-16. It reads only the committed diff in the sibling checkout `Pe.Tools-unify-chat`, from base `1406e70` to `6533201` (commits 5658ec1, 6345064, 7cd5b66 and 6533201); uncommitted work there was ignored. Proof lane: **source reading only.** Nothing was run, benchmarked or edited. The paths below are relative to `source/pe-tools/apps/web/src/`, with line numbers as of `6533201`.

## Findings

### F0: the fetched body is typed as `ChatState` but has no `display`, so `displayKnown` is a false positive (severity: high; root's finding, checked independently here)

- The wire type `ThreadViewState` (`packages/agent-contracts/src/thread.ts:23-35`) has no `display` field. `ChatState` adds `& { display: ChatDisplay }` on the web side (`workbench/chat-state.ts:30-35`).
- `bodyAtoms` casts the GET response with `response.json() as Promise<ChatState>` (`workbench/provider/thread-stream.ts:33`).
- If the body has loaded and no stream frame has arrived yet, `chat` returns `stored` unchanged (`thread-stream.ts:166`), so `chat.display` is `undefined`. In the same state, `displayKnown` is `true` because the body loaded (`thread-stream.ts:186`).

**Reproduction:** open a thread whose `GET /pe/thread/:id` resolves before the SSE snapshot frame, or whose stream is slow or failing.
- `send` passes the `displayKnown` guard (`view.tsx:122`) without any known display.
- `selectApprovals(chat.display)` (`chat-state.ts:393-395`, reached from `chat/composer-head.tsx:124` and `chat/manifest.ts:69`) reads `display.pendingApproval` on `undefined` and throws a TypeError.
- The run/approval gating in `manifest.ts:69` acts on a display it does not have.

**Why the tests pass:** they mock the body as `JSON.stringify(emptyChatState())` (`thread-stream.test.tsx:38,76,100,118`), which *includes* `display`, so they don't match the real wire.

**Suggested fix:** base `displayKnown` on the stream frame only, and type the fetched body as the wire `ThreadViewState` rather than `ChatState`.

### F1: switching threads remounts the whole Chat shell, so the Activity drafts are lost (severity: high)

- `workbench/provider/view.tsx:319-329` wraps **all** of `children`, which is `<ChatShell>`, in `<CurrentThreadViewOwner key={currentThreadId}>`.
- When the key changes, React unmounts and remounts that whole subtree. That subtree includes `ComposerBank` (`chat/chat-shell.tsx:309-351`), its `visited` state, and every `<Activity>`/`ThreadComposer` `useState` draft (`chat/composer.tsx:395`).

**Reproduction:**
1. Open thread A and type "hello" in the composer.
2. Select thread B from the sidebar or palette. `openThread` → `gotoThread` changes `currentThreadId`, so the owner's key changes.
3. Select A again. A's composer is empty. The draft and any attachments were dropped at step 2, because the Activity that should have kept A hidden was unmounted together with its parent.

**Consequences:**
- Per-thread draft custody is defeated in the mounted app.
- The sidebar/pane shell is not stable across a switch: `ChatSurface`, the pane size hooks, `HotkeysProvider` and `useRoute(manifest)` all remount.
- The Suspense boundary in the transcript pane stops being the only region that changes.

**Why the tests pass:** `chat/composer.test.tsx:177` builds its own `<Activity>` harness. It never renders `ComposerBank` under the keyed owner. No test covers the real composition.

**Suggested fix:** the per-thread view owner needs a key that wraps only the lens/world consumers, not the composer bank or the shell. Alternatively, keep the owner without a key and reset it when the thread changes.

### F2: a draft in a new, unsent thread is removed from the Activity set as soon as you leave it (severity: medium; visible once F1 is fixed)

- `chat/chat-shell.tsx:323-334` builds `known` from `threads` (the server list) plus `currentThreadId`, and the pruning step keeps only visited ids that are in `known`.
- `newThread` (`workbench/provider/view.tsx:146-148`) goes to a fresh `crypto.randomUUID()`. That id is not in `threads` until a turn has been sent and `refreshThreads` has run.

**Reproduction:**
1. Choose New thread (id X) and type text or attach a file. Don't send.
2. Open thread B. X is no longer current and is not in `threads`, so the effect removes X from `visited`, and X's `<Activity>` and draft are unmounted.
3. Browser Back to `?thread=X`. The composer is empty.

A related case: on first load, `threads` is `[]` until `listThreads` resolves, so the first pruning pass keeps only the current id. That is harmless, because nothing else has been visited yet.

Whether an unsent new thread should keep its draft is a product decision. This code discards it silently.

## Checked with no finding

- **Delayed thread body vs live approval.**
  - Approvals are rendered in `ComposerHead` (`chat/composer-head.tsx:124`), which sits in the composer pane *outside* the suspended `ThreadBody` (`chat/chat-shell.tsx:230-258`). A live frame with a pending approval is therefore visible while the body is still suspended.
  - `chat.display` prefers the live frame over the stored body (`workbench/provider/thread-stream.ts:170`). The stored body's own display is absent on the real wire (F0).
  - The `send` guard on `displayKnown` (`view.tsx:122`) is unsound; see F0.
- **A/B target identity with async work still pending.**
  - Every `setLive` updater in `thread-stream.ts` (lines 99-183) checks `previous.key !== key`, and the render-time reset (lines 82-84) stops B from showing A's frame or sent list.
  - A torn-down subscription sets `stopped` and unsubscribes when it resolves late.
  - `invalidate` is a `useCallback` over `[registry, atom]` (`@effect/atom-react` `useAtomRefresh`), so it is stable per thread and does not reopen the subscription on every render. A late `invalidate()` from A's closure (for example `view.tsx:130` after `await`) refreshes only A's body atom.
  - A send that finishes after a switch clears only its own composer's draft, and only if that draft is unchanged (`chat/composer.tsx:51-53`). F1 currently makes this moot.
- **Activity cleanup.** Hidden composers are plain `useState` with no effects that hold resources. The `preview` object-URL field was removed from `WorkbenchAttachment` (`workbench/prompt.ts`), so hiding a composer leaks no URL.
- **Suspense boundary.**
  - `ThreadBody` (`workbench/lens/thread-body.tsx`) is the only `useAtomSuspense` call.
  - `Pane` wraps it in an error boundary keyed per thread, with `Suspense` inside (`components/lang/pane.tsx:249-250`).
  - `useAtomSuspense` does not suspend again on a refresh (by default it does not suspend on "waiting"), so a `message_end` refetch keeps the transcript on screen.
  - The boundary is meaningful. F1 is the one issue that undermines it.
- **Thread-only URL seed.** `openThread` removes `prompt`/`turn` (`workbench/store.ts:57-58`). The composer no longer writes `prompt` to the URL. `initialDraft` comes from `prompt` only for the current thread on its first mount (`chat-shell.tsx:342-343`).

## Not covered

Full tool results loaded on expand (not in this diff); the design-system and pane-geometry commits (5596249, aa15cf4, 1f4fdc7); runtime behaviour (not executed).

## Recheck at `23dd5ad` (including `fc073d7`), 2026-09-16

**Proof lane: source only.** I read only committed code, `git diff 6533201 23dd5ad` plus `git show 23dd5ad:<path>`. Nothing was executed. Running the new `workbench/thread-view.test.tsx` would have meant running it in the dirty chat tree or installing a clean worktree; neither is committed-state evidence, and the time bound ruled out the second. No chat source was changed.

| Finding | Verdict | Evidence at `23dd5ad` |
|---|---|---|
| F0: body has no `display` / false `displayKnown` | **Fixed** | `workbench/provider/thread-stream.ts`: the body is typed `ThreadBody` (the fetch cast and `EMPTY_BODY`). Without a body or live state, `chat` returns `EMPTY`. Otherwise `display` is `current.frame ?? EMPTY.display`, never taken from the body. `displayKnown` is `current.frame !== null`. The `view.tsx:122` send guard now waits for a real stream frame, and `selectApprovals` always receives a defined display. |
| F1: keyed owner remounts the shell | **Fixed** | `view.tsx` no longer renders `CurrentThreadViewOwner`. `chat/chat-shell.tsx` `CurrentThreadChatSurface` renders it *without* a React `key` and passes `threadKey={currentThreadId}`. `workbench/thread-view.tsx` hands that to `useRouteOwner(create, threadKey)`, which replaces only the owner object. `ChatSurface`, the sidebar and `ComposerBank` stay mounted when the thread changes. |
| F2: unsent new-thread draft pruned | **Fixed** (the retain decision was already settled) | `chat/composer-bank.tsx` no longer filters by the server `threads` list. It prunes only ids in `deletedThreadIds`, a set that `ChatSurface` adds to after `deleteThread` resolves `true`. A draft in an unsent new thread survives leaving the thread. |

**`useRouteOwner` identity and StrictMode cleanup** (`route/use-route.ts:277-297`): **no finding.**
- When the identity changes, render pushes the old owner onto `retiredRef` and creates the new one.
- In the commit, the old effect's cleanup schedules a disposal of the old owner. The new effect's setup then cancels that timer and disposes the retired owner synchronously, so each owner is disposed exactly once.
- Under StrictMode, the setup → cleanup → setup sequence cancels its own pending timer, so the live owner is not disposed.
- A dev double render with the same identity reuses the owner already created.
- One residual point, not a defect: `create()` runs during render, so a render that is thrown away before commit would still leave a new owner in `storeRef`. Nothing above `ChatSurface`'s own Suspense boundary suspends, so this path is not reachable today.

### F3: opening or closing the plugin workspace remounts the chat column and loses all retained drafts (severity: high; source reading, not executed)

- `chat/chat-shell.tsx` (the `fc073d7`/`23dd5ad` layout) builds `chatColumn` once. The column holds the transcript `Pane`/`ThreadBody` and the `ComposerBank`.
- **Without a plugin,** `chatColumn` is passed directly as the outer `PaneSplit`'s `end`.
- **With a plugin,** `end` is instead a nested `<PaneSplit … start={chatColumn}>`.
- The column's parent element therefore changes type or position depending on `plugin`. React unmounts and remounts the column, including `ComposerBank`'s `visited` set and every `<Activity>` `ThreadComposer` `useState` draft.

**Reproduction (from source):**
1. Type in thread A.
2. Visit thread B and type there.
3. Open a plugin workspace (`?plugin=…`), or close one with the plugin pane's "Close workspace" button (`store.actions.setPlugin(undefined)`).
4. Both drafts are gone. Only the current thread's composer comes back, empty unless a URL `prompt` seeds it.

**Also affected:**
- `deletedThreadIds` survives, because it lives in `ChatSurface`.
- The transcript `Pane`'s Suspense/error boundary remounts too.

**Suggested fix, not designed here:** keep `chatColumn` at the same tree position whether or not a plugin is open. For example, always render the nested split and collapse or omit its `end` pane.

### Remaining defects at `23dd5ad`

- **F3** (above) is the only concrete defect left in the reviewed scope.
- **Not reviewed:** uncommitted polish, full tool results loaded on expand, and runtime behaviour.

## Final disposition, F0–F3 (chat `1176706`, root `fe81172` + `6243b33`), 2026-09-16

**Proof lane: source only.** I ran nothing. Root separately reports 69 combined tests passing; I did not reproduce that. The verdict covers only F0–F3. The shared-owner and composer-help work still in progress is out of scope.

**Commit ancestry:**
- `fe81172` is root's rebased equivalent of chat `1176706`. It has the same subject, and `1176706` is not its ancestor. I checked the relevant code in both commits.
- `6243b33` is an ancestor of `fe81172`.

| Finding | Final verdict | Evidence |
|---|---|---|
| F0: body has no `display` / false `displayKnown` | **Fixed** (from `23dd5ad`, unchanged since) | `workbench/provider/thread-stream.ts`: the body is typed `ThreadBody`, `display` comes only from the live frame, and `displayKnown = current.frame !== null`. |
| F1: keyed owner remounts the shell | **Fixed** (from `23dd5ad`) | `chat/chat-shell.tsx` `CurrentThreadChatSurface` renders the owner without a React key and passes `threadKey`, which `useRouteOwner(create, threadKey)` uses to replace only the owner object. |
| F2: unsent new-thread draft pruned | **Fixed** (from `23dd5ad`) | `chat/composer-bank.tsx` prunes only `deletedThreadIds`. |
| F3: plugin open/close remounts the chat column | **Fixed** | See the three points below. |

**F3 evidence:**
- **The nested split is always mounted.** In `chat/chat-shell.tsx`, the outer `PaneSplit` `end` is now always the nested `PaneSplit`, with `start={chatColumn}`, `end={plugin ? <Pane …/> : null}` and `collapse.collapsed: !plugin || !pluginOpen` (`fe81172` lines 299–324). The column's parent chain no longer depends on `plugin`.
- **The column keeps its React position in `PaneSplit` itself** (`components/lang/pane-resize.tsx` at `fe81172`). The children are always `[renderSide("start"), bothSides && resize && handle, renderSide("end")]`. The `false` handle slot keeps its place, so the start wrapper stays the first child whether or not the plugin exists.
- **The empty plugin side is hidden.** `6243b33` hides the empty end wrapper (`child == null → "hidden"`), and while one side is absent it drops the gutter and the handle and uses a single track (`bothSides`). That is layout only; it does not change the column's React identity.
- **Test coverage (read, not run):** `chat/composer-bank.test.tsx` "current view and plugin open-close retain A, B, and a new unsent X composer" (`1176706`) exercises this case.

**Remaining defects in the reviewed scope (F0–F3): none.**
