# State-architecture bake-off — the shared scenario

Every candidate builds THIS route, the same way, so the protos compare. The scenario is a
compression of `/takeoffs` + `/runs` (takeoff-frontier worktree) and the targeting manifest
(`src/targeting/model.ts`). Read those first; do not copy their code.

## The route: `/state-bench/<candidate>`

A takeoff-like page with a **sentence** (bindings), **stages of verbs**, and **three panes** that
share selection/hover. Bindings form a waterfall. Everything live comes from a **mock host** with
latency, failure, and push events.

### Binding waterfall (URL search state)

```
session ─▶ doc ─▶ view ─▶ zones (multi)
folder ─▶ r10
```

- Re-picking a parent clears every descendant (see `pickInto` in targeting/model.ts).
- Every binding lives in URL search params (TanStack Router `validateSearch`), so reload restores it.
- Options for each link are a `Feed` = `{ options: Option[] | null, state: FeedState, at?, note? }`,
  `FeedState = live | fresh | stale | loading | error | fixture` — same meaning as targeting/model.ts.

### Mock host (the ONLY data source; each proto ships its own copy of this interface)

```ts
interface MockHost {
  listSessions(): Promise<Session[]>;                      // 300ms
  activeDoc(sessionId): Promise<Doc>;                      // 200ms
  listViews(sessionId, docId): Promise<View[]>;            // 600ms
  listZones(sessionId, docId, viewId): Promise<Zone[]>;    // 800ms; 1 in 4 calls REJECTS
  listFolder(dir): Promise<R10File[]>;                     // 400ms
  openR10(path): Promise<R10>;                             // 500ms
  adoptZones(sessionId, docId, zoneIds[]): Promise<Receipt>; // 1500ms WRITE; afterwards zones feed is STALE until re-read
  events: subscribe((e: { kind: "docChanged" | "sessionGone"; sessionId }) => void) // push; fire from a devtools button
  // knobs the proto's UI exposes: latency multiplier, failure on/off, fixture mode on/off
}
```

`fixture mode` = the host is replaced by a canned in-memory dataset with 0ms latency and
`FeedState = "fixture"`. This must be a ONE-LINE swap at the composition root, and the same swap
must work in a vitest test with no React rendered.

### Panes (all three read the same selection + hover)

| Pane | Draws | Behaviour |
|---|---|---|
| Zone list | zones | click = select (multi, in URL); hover = hover (page memory, NOT URL) |
| Plan (SVG rects, one per zone) | view, zones | same selection/hover, from the other direction |
| Staging table | zones, selection | shows STAGED edits (rename a zone); dirty rows; `Adopt` verb commits, then invalidates zones |

Hover in one pane must highlight in the other two at 60fps with 500 zones (measure it).

### Stages / verbs

- `read` stage: `Refresh zones` (re-read; marks fresh), `Open in RHVAC` (nav; demands r10)
- `adopt` stage: `Adopt` (commit verb; demands session, doc, view, zones≥1; refuses when the zones feed is `stale` or `loading`; while running, `busy` + seconds counter; result = receipt shown in a toast; on success → zones feed `stale` → auto re-read).
- Refusal reasons are DERIVED (see `refusal` in targeting/model.ts), never flagged.

### State kinds the proto must keep visibly separate

| Kind | Examples here | Where |
|---|---|---|
| URL | bindings, stage, selected zone ids | router search |
| Persisted | recent folders (max 8), pane widths | localStorage |
| Page memory | hover, open panel, staged renames, verb busy/receipt | in-memory store |
| Host cache | sessions, doc, views, zones, folder listing, r10 | the library's async layer |
| Derived | feeds, bound/complete progress, seams, refusals, world | computed, never stored |

### React 19 requirements

- Each pane is `<Suspense>`-wrapped with a per-pane fallback; show what the library does when a
  feed is loading (does it suspend? does it hand you status?). Both styles if the library allows.
- Wrap the Plan pane in `<Activity mode={visible ? "visible" : "hidden"}>` (React 19.2). Hidden
  pane must keep its state; note whether subscriptions keep firing and what that costs.
- Use `useTransition`/`startTransition` for the binding pick so the sentence stays responsive.

### Devtools / visibility

Wire the library's devtools (or the closest thing). If none exists, build the cheapest
inspector: a `<pre>` of the whole state tree + last 20 actions. Screenshot it.

## Deliverables per candidate (in the candidate's worktree)

1. `source/pe-tools/apps/web/src/state-bench/<candidate>/` — the proto (store, mock host,
   panes, route file `routes/state-bench.<candidate>.tsx`). Route must compile under `vp check`.
2. `source/pe-tools/apps/web/src/state-bench/<candidate>/bench.test.ts` — vitest, NO React:
   fixture swap, waterfall clears descendants, adopt → stale → refresh, failure surfaces as
   `error` feed, push `docChanged` invalidates doc+views+zones.
3. `docs/research/state-arch/<NN>-<candidate>.md` — the research + proto report (template below).

## Report template (`docs/research/state-arch/<NN>-<candidate>.md`)

1. **Library facts** (cite source/docs, with version): maintainer, release cadence, bundle size,
   React 19 / Suspense / Activity / transitions support, devtools, SSR/TanStack Start fit,
   effect v4 (effect-smol) compatibility.
2. **Mental model in one diagram** (mermaid) + the smallest complete example.
3. **How the scenario mapped**: table of state kind → primitive used. Where it fought you.
4. **Async waterfalls**: how dependent async is expressed; dedup, cancellation, stale-while-
   revalidate, retries, invalidation, push events. Code snippet of the session→zones chain.
5. **Fixture/mocking**: the one-line swap; the no-React test. Snippet.
6. **Perf**: hover across 3 panes at 500 zones — measured ms/frame or React Profiler commit count;
   how many components re-render on hover.
7. **URL / persisted / page separation**: what the library gives vs what you built.
8. **DX**: lines of code for the proto (store vs view), type inference quality, devtools screenshot
   path, the three worst papercuts.
9. **Verdict**: fit to kaitpw's three wants (centralized importable object; state handles its own
   waterfalls; mockable) scored 1–5 each with one-line evidence; recommend / reject / hybrid-with.
10. **What you would steal** even if rejected.
