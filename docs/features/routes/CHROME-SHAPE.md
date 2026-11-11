# Slice 6, Chrome: the shape

The fill plan for [MAP](MAP.md) row 6 under [ADR 0035](../../adr/0035-route-slots-subjectref-one-notice-feed.md) rules 5, 6 and 7. Scaffold branch `crusade/kernel-chrome-scaffold` from the slice 5 candidate `4fb8159a`: types, stubs and red tests, no behavior. Delete this file when slice 6 lands; what survives goes to the [routes ledger](LEDGER.md) and the [design-system ledger](../design-system/LEDGER.md).

Two accounts. The ask: two chrome layers (topbar, pane heads), chrome derived from filled slots, layout as data with a branded `Body`, consent in two places, one host-owned notice feed, with the owner's uncommitted triage diff as input. The repo at `4fb8159a`: three chrome layers on /pea (the Situation band, the kernel's pane head, then the chat drawing's own nested `GraphLayoutView` with its own `Pane` heads), a `HistoryRail` above every typed route, a Refresh button minted into every pane head, consent drawn in five branches (the write button, Start, the composer `ArmingStrip`, two Timeline-head branches, the tray card), and "what needs a person" derived twice (`notices.ts` on the host for the card, `navigation/ledger.tsx` in the browser for Activity). Where they differ is the whole slice; nothing here is already done.

## The contracts (quoted verbatim from the scaffold)

**Body**, `ts/apps/web/src/route/body.ts`:

```ts
export type BodyKind = "scroll" | "fill";
export type Body<K extends BodyKind = BodyKind> = { readonly [bodyBrand]: K; readonly kind: K; readonly node: ReactNode };
export const scrollBody = (node: ReactNode): ScrollBody   // the pane scrolls this body
export const fillBody = (node: ReactNode): FillBody       // this body fills the pane and scrolls itself
export const scrollTracks = (panes: Readonly<Record<string, PaneBodyDecl>>) => number
```

A pane declaration gains `body?: BodyKind` (`typed-route.ts`, `Specification.panes[K].body`). In the fill it is required and `draw` is typed `(ctx) => Body<typeof body>`, so the brand and the declaration cannot disagree. The dock's panes are data too: `ts/apps/web/src/workbench/dock-layout.ts` `DOCK_PANES: Record<"pea" | "tools", PaneBodyDecl>`.

**ConsentSweep**, `ts/packages/kit/src/components/lang/consent-sweep.tsx` (`@pe/kit/lang/consent-sweep`):

```ts
export interface ConsentWindow { requestId; threadId; thread; verb; deadline?: string; reject: { optionId } | null }
export interface ConsentSweepProps { windows: readonly ConsentWindow[]; onReject(window): void; shell: "topbar" | "card" }
export function ConsentSweep(props: ConsentSweepProps): ReactNode   // stub: throws "kernel gap"
```

**Notice feed**, `ts/packages/agent-contracts/src/notice-feed.ts` (exported from the barrel):

```ts
export const NOTICE_GROUPS = ["waits", "working", "interrupted", "failed", "unread"] as const;
export const noticeActSchema   // consent | question | reply | resume | automatic-updates
export const noticeRowSchema   // { key, group, revision, verb, what, where, says, at, url, refusal?, detail?, act? }
export const noticeFeedSchema  // { id: log id, rows: NoticeRow[], tray: boolean }
export const noticeRows = (feed, group) => NoticeRow[]
export const consentWindows = (feed) => { row, act }[]
```

The Reading request stays `{ kind: "notices", as?: "tray" }` (`reading.ts`); its `snapshot` frame becomes a `NoticeFeed`. Host door: `ts/apps/host/src/notice-feed.ts` `createNoticeFeed({ build, subscribe }): { observe, close }` (stub: throws). Browser door: `ts/apps/web/src/navigation/notice-feed.ts` `useNoticeFeed(): Reading<NoticeFeed>`, `feedRows(feed, groups)`.

## Seams, disjoint writers

Order across seams: (a) and (c) are independent and may run in parallel; (b) consumes (c)'s `consentWindows` and lands after (c)'s host side publishes, or stubs its windows from `WorkbenchContext.runApprovals` first and switches when (c) lands (both branches named in (b)).

### Seam (a): layout as data, `Body`, the frame-knob deletion, the import guard

Files: `apps/web/src/route/body.ts`, `apps/web/src/route/typed-route.ts`, `apps/web/src/route/draw.tsx`, `apps/web/src/shell/typed-shell.tsx`, `apps/web/src/shell/history-rail.tsx`, `apps/web/src/workbench/route-panes.tsx`, `apps/web/src/workbench/dock-layout.ts`, `apps/web/src/workbench/route-tabs.tsx`, `apps/web/src/chat/route.ts`, `apps/web/src/chat/chat-drawing.tsx`, `apps/web/src/chat/thread-palette.tsx`, `apps/web/src/chat/composer.tsx`, `apps/web/src/rooms/{inbox,mount,plan}.tsx`, `packages/agent-contracts/src/route-kernel-data.ts`, `packages/kit/src/components/lang/{graph-layout,teaching-layout,pane}.tsx`, `tests/repo-guards/src/chrome-imports.guard.test.ts`.

Contract: the pane head is the kernel's, derived from the declaration and the filled slots: the declared `title`, the subject crumb when this pane is the subject slot's pane (I4: scope › subject › selection; the thread name is the chat pane's crumb), and the body's own `PaneActions` portal (`shell/pane-actions.tsx`, kept). The body is a `Body`; `scroll` gives the pane the one scroll track and `fill` makes the pane clip. The Places tab strip (`workbench/route-tabs.tsx`) is the dock's tools pane head, drawn by `RouteDock` from `DOCK_PANES`, never by the tool. Two layers only: the topbar (the app bar with the Situation band) and pane heads. Nothing else draws a head.

Deletes, `path:line` at `4fb8159a`:
- `apps/web/src/shell/history-rail.tsx:32` `HistoryRail` and its render at `apps/web/src/shell/typed-shell.tsx:103` and import at `:19`. `HistoryBoundary` stays (it resolves the recorded point, not chrome). Its capture and live verbs move into the Timeline popover (`shell/situation-band.tsx` `TimelineHead`), which already is the recorded-history door.
- Per-pane Refresh: `apps/web/src/shell/typed-shell.tsx:134`, the `Button` minted into every pane's `actions`. An explicit-demand read (`read.demand === "explicit"`) keeps its Read as a Situation verb in the topbar; nothing else re-reads from chrome.
- The `frame` knobs: `packages/agent-contracts/src/route-kernel-data.ts:135-142` (`frame: { picture, scroll, flush, header: false }`), `packages/kit/src/components/lang/graph-layout.tsx:40` (`pane: declared.frame`), `packages/kit/src/components/lang/teaching-layout.tsx:186-189` (`header === false`, `scroll`, `flush` pass-through), `apps/web/src/workbench/route-panes.tsx:117` and `:124` (`frame: { header: false, flush: true, scroll: "clip" }`), `apps/web/src/chat/chat-drawing.tsx:256` and `apps/web/src/chat/thread-palette.tsx:1028` (`scroll="clip"` on route-drawn `Pane`s). `scene/picture/picture.tsx:74` keeps `scroll="clip" flush` because the picture is a kernel module (the picture slot), not a route; it becomes a `fillBody` when slice 8 lands.
- `Pane` and `GraphLayoutView` exports to routes, the guard's red list: `chat/chat-drawing.tsx:40,53,54`, `chat/composer.tsx:14`, `chat/thread-palette.tsx:45`, `rooms/inbox.tsx:15`, `rooms/mount.tsx:20`, `rooms/plan.tsx:20`. The kit keeps exporting both to the kernel (`packages/kit/src/index.tsx:8-14`); the guard holds the route line.
- `chat/route.ts`: the one `main` pane and `paneLayout("main")` become two panes `threads` (`body: "scroll"`) and `chat` (`body: "scroll"`) on `chatLayout` (the split already declared at `chat/route.ts:13-25`), and `chat-drawing.tsx` stops nesting its own `GraphLayoutView`. `fields.mode` (`threads | world`) and the world inspector die with it (the triage diff, kept).

Red tests: `apps/web/src/route/body.test.ts` (/pea declares two scroll bodies; the dock declares one), `tests/repo-guards/src/chrome-imports.guard.test.ts` (eight offenders listed above). Driver's browser twin, on the real /pea and the real dock with a Place open: count elements whose computed `overflow-y` is `auto` or `scroll` and whose `scrollHeight` can exceed `clientHeight`; /pea is 2 and the dock's tools pane is 1, and the count equals `scrollTracks` of the declaration.

Order inside (a): `Body` and the pane `body` knob first (compile-visible), then `typed-shell.tsx` reads the brand and deletes Refresh and `HistoryRail`, then the chat route moves onto two panes, then the frame knobs and the kit pass-throughs are deleted (the compiler lists every remaining site), then the guard goes green.

### Seam (b): consent in two places

Files: `packages/kit/src/components/lang/consent-sweep.tsx` plus its swatch specimen under `apps/web/src/design-system/specimens/`, `apps/web/src/navigation/app-bar.tsx`, `apps/web/src/machine/notice.tsx`, `apps/web/src/chat/composer-pending.tsx`, `apps/web/src/shell/situation-band.tsx`, `apps/web/src/shell/consent-timeline.test.tsx`, `apps/web/src/chat/composer-pending.test.tsx` (if present), `apps/web/src/design-system/laws.tsx` and the specimens that still cite `ArmingStrip` for consent ceremony.

Contract: consent is drawn by the write button that asked (`TypedWrite` and `TypedStart` in `typed-shell.tsx`, their `Reject? {until}` beside the button, kept) and by one `ConsentSweep`. On web the sweep sits in the topbar (`navigation/app-bar.tsx`, in the app bar shell beside the Situation outlet, `shell: "topbar"`); in the tray it is the card (`machine/notice.tsx`, `shell: "card"`, replacing the card's own permission branch at `machine/notice.tsx:286-300`). The sweep's windows are `consentWindows(feed)` from the notice feed (seam c); until (c) lands on the host, the web topbar may build them from `WorkbenchContext.runApprovals` (`workbench/provider/thread-summary.tsx:21`) and the Timeline rows' `consentWindow`, and that bridge is deleted when (c) lands. Reject answers `thread.permission` with the window's reject option (`stop_writes` for run consent), the same door the write button answers. A sweep "goes down": the countdown is a bar that empties downward, drawn once in the kit with its specimen (house law 10), monotone with `caution` on the timer alone (I3).

Deletes, `path:line` at `4fb8159a`:
- `apps/web/src/chat/composer-pending.tsx:4` (import) and `:111-134` (the `ArmingStrip` consent card). `ComposerPending` keeps its questions; its approvals section is deleted, and `WorkbenchContext.runApprovals` feeds the sweep instead. `packages/kit/src/components/lang/arming-strip.tsx` stays for the `open/` route's blast-radius ceremony (`open/bay.tsx`, `open/lifecycle.tsx`), which is not consent.
- `apps/web/src/shell/situation-band.tsx:233-262` (the receipt `windows.map` branch) and `:264-284` (the `runAsks.map` branch), with their inputs at `:212-221` (`runAsks`, `asked`, `windows`, `useSecondTick`) and the `WorkbenchContext` import at `:17`. The D8 test in `shell/consent-timeline.test.tsx` moves to the sweep.
- The design-system ledger line "`ArmingStrip` … arming strip ceremony" under Honesty is amended to name the sweep.

Red tests: `apps/web/src/shell/consent-sweep.test.tsx` (one `<ConsentSweep` in `machine/notice.tsx` and `navigation/app-bar.tsx`; no `ArmingStrip` under `chat/`; `TimelineHead` draws no `[data-slot="consent-window"]` with a run ask open).

### Seam (c): the notice feed on the host and its three readers

Files: `packages/agent-contracts/src/notice-feed.ts`, `packages/agent-contracts/src/reading.ts`, `apps/host/src/notice-feed.ts`, `apps/host/src/notices.ts`, `apps/host/src/pe-routes.ts`, `apps/host/tests/receipt-notices.test.ts`, `apps/host/tests/notice-feed.test.ts`, `apps/web/src/navigation/notice-feed.ts`, `apps/web/src/navigation/ledger.tsx`, `apps/web/src/navigation/ledger-model.ts`, `apps/web/src/navigation/global-search.tsx`, `apps/web/src/machine/{notice-follow.ts,os-notices.tsx,notice-policy.ts,notice.tsx}`, `apps/web/src/home/mount.tsx`, `apps/web/src/chat/chat-drawing.tsx` (the tray Activity branch).

Contract: the host builds one `NoticeFeed` from its own stores and serves it as the `notices` Reading's `snapshot`, rebuilt once per source change, with `id` the host log id it was built at and `tray` whether a tray follows. Rows: a waiting thread is `waits` with its open ask's words (`verb: asks | approve`, `act: consent | question`); a running thread is `working`; a host-restart death is `interrupted` with `act: resume`; a failed turn or failed receipt is `failed` with `detail`; a thread whose `readSeq < lastSeq` is `unread` with `act: reply`; staged Work is `waits` with `verb: review`; a machine attention line is `waits` with `verb: machine`. The grouping and words move from `ledger-model.ts` (`threadRow :78`, `receiptRow :131`, `ledgerRows :160`, `openAsk :59`) to the host, verbatim where they already say it. Push: the tray card and the OS notification raise a row when its `revision` moves past the follower's cursor (`notice-policy.ts` keeps acknowledge, snooze and "looking"); a finished-turn burst is one revision, not thirty seconds of buffer. Pull: `Ledger` (home and tray) and `useLedgerList` (the overlay) take `feedRows(feed, NOTICE_GROUPS)` and draw them; the overlay's empty state is the feed's two leading notes. The tray holds the notice feed, consent and compact chat: `settings/route.ts:45` `surfaces.tray` becomes `false` and the route field's launcher stays off the tray (`navigation/app-bar.tsx`, `shell.field` already `global` only on web).

Deletes, `path:line` at `4fb8159a`:
- The browser join: `apps/web/src/navigation/ledger.tsx:52-128` (`useLedgerRows`: the summaries stream at `:62`, the `actions.read` poll at `:76`, the per-thread `thread.get` ask read at `:98`), and `ledger-model.ts:48-57` (`LedgerSources`), `:59-76`, `:78-129`, `:131-158`, `:160-203` once the host owns the words. `LedgerRow` becomes `NoticeRow`; `LedgerPresentation` and `LEDGER_PRESENTATIONS` stay (they are the three drawings of one feed). `resumeThread` (`ledger.tsx:131`) stays as the `resume` act's answer.
- The second projection: `apps/host/src/notices.ts:62-181` (`noticeOf`, one receipt revision to one card) and the buffer in `createNotices :183-287`; `observe :289` is replaced by `createNoticeFeed().observe` in `pe-routes.ts:1406`. Presence (`beat`, `forTray`) moves to the feed unchanged. `MachineNotice` stays only as the card's drawing input, built in the browser from a `NoticeRow`.

Red tests: `apps/host/tests/notice-feed.test.ts` (the Reading's first frame is a grouped `NoticeFeed` snapshot), `apps/web/src/navigation/notice-feed.test.tsx` (home Activity, tray Activity and the Mod+Shift+K overlay draw a feed row with every other source dead; the overlay is `ready` when the feed answered).

Order inside (c): the host feed first (its test), then `ledger.tsx` reads it (its three tests), then the card and the OS follower, then `notices.ts` is deleted and `receipt-notices.test.ts` is rewritten against the feed.

## From the triage diff

The owner's uncommitted diff in the root checkout (`C:\Users\kaitp\source\repos\Pe.Tools`, at `205461ae`, 45 files, read only). The docs, skills, roles and `machine.py` parts are not chrome and are out of this slice (several are already on this branch as ADR 0034 and 0035). The TS parts, each kept or dropped:

Kept (a fill writer re-authors these; the diff is not copied):
- `ts/apps/web/src/chat/route.ts`: two panes `threads` and `chat` on `chatLayout`; `fields.mode` and the world inspector deleted; the summary "The Pea agent workbench."; `minOtherSize` as a fixed px floor (the owner: "Layout is data, so the token-derived floor is fixed here"). Seam (a). The `frame` knobs on both panes are dropped (below).
- `ts/apps/web/src/chat/chat-drawing.tsx`: `ThreadsDrawing` and `ChatDrawing` as two pane drawings; the nested `GraphLayoutView`, `SidebarShown`, `peaFloor()`, `KeyScope` with Mod+1/Mod+2 and `SessionStrip` deleted; the thread's title as the chat pane's head; `ContextBar` takes `side` as a prop. Seam (a), with one change: the drawings return `scrollBody(...)` and draw no `Pane` of their own (the diff still drew `<Pane id="transcript">` inside the chat pane, a third layer).
- `ts/apps/web/src/chat/thread-palette.tsx`: `ThreadPane` and the mode `Switcher` deleted; `ts/apps/web/src/workbench/depth.ts` deleted. Seam (a).
- `ts/apps/web/src/workbench/store.ts`: `threadFold`, `revealThreads`, `revealChat`, `setMode` deleted; `composing` and `deletedThreads` atoms with `compose` and `forgetThread`. Seam (a).
- `ts/apps/web/src/workbench/provider/view.tsx`: the `mode` search field gone. Seam (a).
- `ts/packages/agent-contracts/src/routes/{chat,pea}.ts`, `ts/apps/web/src/chat/context.generated.ts`, `ts/packages/mcps/src/pea/generated/chat-graph.json`, `ts/packages/agent-contracts/src/generated/route-directory.ts`, `dotnet/Pe.App/Host/PeRoutes.generated.cs`: regenerated outputs of the `mode` deletion; the fill regenerates, never hand-edits. Seam (a).
- `ts/apps/web/src/shell/situation-band.css`: `flex: 0 1 auto; width: 100%` so the band owns its geometry in a column parent. Seam (a); it is the topbar layer.
- `ts/apps/web/src/route/kernel-journeys-focus.test.tsx`, `workbench/route-panes.test.tsx`, `chat/thread-palette.test.tsx`: the `mode` removal in fixtures. Seam (a).
- `ts/packages/agent-contracts/src/chat-state.ts` (+ test): a run-consent ask that opened its own row completes on allow, so the transcript stops drawing consent as a failed tool. Not chrome, but it is the consent record the sweep answers; seam (b) carries it so the sweep and the transcript agree.
- `ts/apps/host/src/harness/threads.ts` (+ `fake-acp-agent.mjs`, `harness-threads.test.ts`): one terminal per turn when the harness dies, with the exit sentence as the transcript's and stderr as raw detail. Not chrome; it is the `failed` row's `says` and `detail` in the feed, so seam (c) carries it.
- `ts/apps/web/src/workbench/moments.tsx`, `record-lines.tsx`, `lens.css`, `conversation-sequences.test.tsx`: a failed call speaks once in its run's row (one toned glyph, a count, the label once; the receipt link's refusal as its hint). Transcript, not chrome; kept as-is for whichever writer touches `workbench/` first (seam a, since it owns chat-drawing).
- `ts/apps/web/src/design-system/specimens/lang-chat.tsx`: follows `thread-palette.tsx`. Seam (a).

Dropped (superseded by the ADR):
- `ts/apps/web/src/route/typed-route.ts` `frame?: PaneDecl["frame"] & { refresh?: false }` and its projection into `data.panes[id].frame`: the `frame` knobs are deleted, not extended. `body: BodyKind` replaces them (seam a).
- `ts/apps/web/src/shell/typed-shell.tsx`: `p.frame?.header === false ? {} : …` and `p.frame?.refresh === false ? null : <Button>` (the Refresh survives behind a knob): Refresh is deleted outright, and the pane head derives from slots.
- `ts/apps/web/src/route/pane-layout.ts` (untracked) `PaneLayoutContext` / `usePaneLayout` with `folded` and `reveal`, and `typed-shell.tsx`'s provider for it: a route reaching into the kernel's fold state is a third way to drive chrome. The reveal the chat drawing needs (pick a thread, show the chat pane under the floor) is the subject slot's: choosing the subject reveals the subject's pane, kernel-owned, declared nowhere. Re-openable if a non-subject reveal appears.
- `ts/apps/web/src/chat/route.ts` `frame: { scroll: "clip", flush: true, refresh: false }` and `frame: { scroll: "clip", flush: true, header: false }`: the knobs. `header: false` on the chat pane existed to let the drawing draw its own `Pane` head with the thread's title; the kernel head draws the subject crumb instead.
- `ts/apps/web/src/chat/chat-drawing.tsx` `<Pane … title={chat.title …} actions={<ChatCluster/>}>` inside the chat pane and `PaneActions pane="threads"` for the count and New: the inner `Pane` is the banned third layer; the thread's title is the crumb; `ChatCluster` and New go through `PaneActions` into the kernel head (kept mechanism, moved).
- `docs/features/design-system/LEDGER.md` (+2 lines), `docs/features/routes/{LEDGER,MAP,GLOSSARY}.md` (large rewrites): already on this branch in their landed form or owned by the root thread; not re-authored here.

## Defaults, re-openable

Where the triage diff and the ADR disagree, and the pick:

1. **Pane head for the chat pane.** Diff: `header: false` plus a route-drawn `Pane` with the thread's title. ADR: two layers, chrome from slots. Pick the ADR: the kernel head draws the subject crumb (the thread), the drawing returns a `scrollBody`. The chat route declares its subject as the thread (`subject.pane: "chat"`), which slice 10 was going to do anyway.
2. **Reveal across the floor.** Diff: `usePaneLayout().reveal("chat")`. ADR: nothing declared. Pick kernel-owned: choosing the subject reveals the subject slot's pane. Re-open if a non-subject reveal is needed.
3. **Refresh.** Diff keeps it behind `refresh: false`. ADR deletes it. Pick delete; an explicit-demand read keeps Read as a Situation verb in the topbar.
4. **Pea floor.** Diff fixes `minOtherSize: 643` from the token math. Keep the fixed number with the comment (layout is data; a computed floor is a render-time guess).
5. **`design-system/` and the import guard.** The ADR names route modules; design-system is a route by file but the kit's only window (ADR rule 10). Exempt it from `chrome-imports.guard`; everything else under `apps/web/src/*/route.ts` is held.
6. **`PaneApi` under the guard.** The ADR names `Pane` and `GraphLayoutView`; the guard also refuses any import from `graph-layout` (`PaneApi`, `GraphLayoutState`), because those exist only to drive `GraphLayoutView`. Rooms' three sites are red by this choice.
7. **Where the sweep sits on web.** The ADR says "the topbar sweep". Pick the app bar shell (`navigation/app-bar.tsx`), beside the Situation outlet, not inside the band, so a route-less page (Home) still shows it.
8. **The notice feed's shape.** One `snapshot` of all rows versus `event` frames per row. Pick snapshot with a log `id` and per-row `revision`: pull reads the snapshot as it is, push raises rows whose revision moved past the cursor, and the thirty-second burst buffer in `notices.ts` is deleted because a turn's rows settle in one revision.
9. **`MachineNotice`.** Kept as the card's drawing input built from a `NoticeRow` in the browser, not sent by the host. Delete it when the card draws `NoticeRow` directly.
10. **Picture `scroll="clip"`.** `scene/picture/picture.tsx:74` keeps it until slice 8 makes the picture a `fillBody`; the picture is a kernel module, so the guard does not see it.
11. **Not admitted: the full suite.** The machine policy refuses `admit suite` to a delegated child ("runs typecheck and the tests its diff touches"), so this scaffold proves four `tsc` runs, the full repo-guards (a guard is `light`), and the touched neighborhoods; the wave candidate runs the full suite.

## Risk

Presentation tier (MAP): measured rails, no data path, except seam (c)'s host feed, which moves words that people act on (asks, failures) from one projection to another; its receipt-notices test is rewritten, not deleted, and the OS follower's cursor semantics (no repeat, no skip) keep their test.
