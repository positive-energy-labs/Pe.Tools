# Reading guide — the shortest path through the bake-off

For kaitpw. Read-only. This file names the fewest pages that carry the result.

**Total: 3 doc sections, 7 protos, 9 snippets.** If you read one thing, read
[08-synthesis.md §2](08-synthesis.md) — the ten-part shape. Everything else is evidence for it.

## Path legend

| Token | Expands to |
|---|---|
| `W<c>` | `C:\Users\kaitp\source\repos\Pe.Tools-sb-<c>\source\pe-tools\apps\web\src` |
| proto | `W<c>/state-bench/<c>/` |
| route | `W<c>/routes/state-bench.<c>.tsx` |

Branches: `research/state-bench-<c>`. Judge files: `judge-<c>.md`, beside this file.

---

## 1. Docs — read in this order

| # | Read | Range | Why this, and only this |
|---|---|---|---|
| 1 | [08-synthesis.md](08-synthesis.md) | §1 scoreboard (`:8-25`), §2 the shape (`:26-59`), §3 substrate (`:60-92`) | S1–S10 is the answer. §2 is a table of ten parts, each named by two or more judges. The mermaid diagram at `:47` is the whole architecture on one screen. |
| 2 | [09-wildcards.md](09-wildcards.md) | §0 only — F1, F2, F3 | Three facts that change the other reports. F1: effect v4 has `Atom` in core. F2: `useSyncExternalStore` defeats `useTransition`. F3: a hidden `<Activity>` unsubscribes external stores. |
| 3 | [00-baseline-census.md](00-baseline-census.md) | §10 only — R1–R20 (`:512-538`) | The requirements every proto was scored on. Read it last, as the rubric behind the scores, not first. |

Skip 01–07 and 11 unless a snippet below makes you want the full report. Skip §4–§6 of 08
unless you plan to build; §4 is the owed list.

---

## 2. Protos — fewest files, in reading order

| # | Candidate | Verdict | Read this | Why these lines |
|---|---|---|---|---|
| 1 | **effect-atom** | **hybrid — strongest; the recommendation.** 35/40 census, 26/32 qr-repo, 17 met / 5 partial / 0 faked, 0 `useState`, 0 misplaced logic | `model.ts:141-181`, `model.ts:287-372`, then `bench.test.ts` (113 lines, whole) | Three ranges, one file plus the test. `:141-181` is the Feed projector — the one place library async becomes domain freshness. `:287-372` is the six-node waterfall — the only tracked dependent async in the bake-off, proven by probe P1. The test is the whole no-React proof at 113 lines. |
| 2 | **preact** (control arm) | hybrid — reject as default. 22/40, 21/32, **9/10 non-negotiables** (best), best store/view split | `model.ts:48-160`, then `async.ts:47-120` | `model.ts:48-160` is the whole `createModel` body: signals, the waterfall, the staged-edit merge. `async.ts:47-120` is the 200-line `asyncCompute` — the explicit `get` tracker that fixes qr-repo W1, with per-run `AbortSignal`. Read the call sites first; drop into `async.ts` only to see how the tracker works. |
| 3 | **jotai** | hybrid. 22/40, 19/32, 17 met / 5 partial | `store.ts:246-360` | One range. It holds both halves of the verdict: `:283` and `:294` are two parallel implementations of the same zones read, and `:338-348` overwrites a carried `basis` with side-flag freshness. |
| 4 | **tanstack** | hybrid. 23/40, 16/32 | `model.ts:454-530`, then `model.ts:601-611` | `:454-499` is the `queryOptions` factory block — the only place a key is spelled, and the graft. `:601-611` is `isInvalidated` → `stale`, the census's first real `stale` producer. Skip the class field block at `:116-137`; it is the seam the judge rejected. |
| 5 | **xstate** | hybrid — reject the library. 24/40, 14/32, 0 hooks in panes | `store.ts:35-59` | 25 lines. Plain data plus one pure function. It answers census R2 and R16 for two independent binding trees. Nothing else in the 775-line store is worth the time; the async centre is a hand-written query cache at about 40 % of one. |
| 6 | **legend** | **reject.** 24/40, 19/32 | `store.ts:311-334` | 24 lines. This is the defect that defines the candidate: a hand-written promise around `onChange` standing in for the library's async authority. Probe B logged `refresh3=HUNG`. If you want the good half, `store.ts:26-83` is `BINDING_GRAPH` + `pickInto`, but xstate `store.ts:35-59` is the same pattern, shorter. |
| 7 | **zustand** | **reject.** 24/40, 14/32, **1/10 non-negotiables** (worst) | `bench.ts:636-660` | 24 lines. `settle()` and `retain()` are the only two things the judge asked a winner to steal. The waterfall at `:257-300` is worth one glance to see what "React-free but imperative" costs. |

---

## 3. Snippets

### 3.1 effect-atom — the `get.result` waterfall

The discriminating fact: `viewsResultAtom` has no reactivity key and never reads
`docResultAtom` in its atom body. The only path from doc to views is `get.result` inside the
generator. One key invalidated reaches three hops and stops at the branch boundary.

```ts
// Weffect-atom/state-bench/effect-atom/model.ts:313-328
  const viewsResultAtom = runtime
    .atom((get) => {
      const host = get(hostAtom);
      return Effect.gen(function* () {
        const link = yield* get.result(docResultAtom, { suspendOnWaiting: true });
        if (!link.value) return unbound<ViewLink | null>(null);
        const { doc, session } = link.value;
        const views = yield* timed(() => host.listViews(session.id, doc.id));
        return {
          value: { ...link.value, views: views.value },
          at: views.at,
          bound: true,
        } satisfies Timed<ViewLink | null>;
      });
    })
    .pipe(Atom.keepAlive, Atom.withLabel("bench/views-result"));
```

### 3.2 effect-atom — the Feed projector

One function turns `AsyncResult` plus two flags into the domain `FeedState`. `stale` comes from
`result.waiting`, so it has a real producer. This is the only file to edit when Q2 and Q3 are
answered. Judge graft F3; synthesis S3.

```ts
// Weffect-atom/state-bench/effect-atom/model.ts:148-172
function resultFeed<A>(
  result: AsyncResult.AsyncResult<Timed<A>, Error>,
  options: (value: A) => OptionItem[],
  settings: { readonly fixture: boolean; readonly live?: boolean },
): Feed {
  if (AsyncResult.isInitial(result))
    return { options: null, state: "loading", note: "not read yet" };
  if (AsyncResult.isFailure(result)) {
    return { options: null, state: "error", note: String(Cause.squash(result.cause)) };
  }
  if (!result.value.bound) {
    return { options: null, state: "fresh", at: result.value.at, note: "unbound; no host read" };
  }
  return {
    options: options(result.value.value),
    state: result.waiting
      ? "stale"
      : settings.fixture
        ? "fixture"
        : settings.live
          ? "live"
          : "fresh",
    at: result.value.at,
  };
}
```

### 3.3 effect-atom — the fixture swap

The fixture replaces the capability root, not individual reads. One writable node holds the
whole `MockHost`. The same seam is the test's constructor argument. Judge graft F1; synthesis
S5; census R14.

```ts
// Weffect-atom/state-bench/effect-atom/model.ts:686-691
      setFixture(enabled: boolean) {
        registry.set(hostAtom, enabled ? fixture.host : live.host); // one-line capability-root swap
        registry.update(knobsAtom, (knobs) => ({ ...knobs, fixture: enabled }));
        subscribeHost();
        log(`fixture ${enabled ? "on" : "off"}`);
      },

// Weffect-atom/state-bench/effect-atom/bench.test.ts:19-29 — same seam, no React
  it("swaps the whole host for the zero-latency fixture", async () => {
    const live = createMockHost({ latency: 0 });
    const fixture = createMockHost({ fixture: true });
    const state = createEffectAtomBench(live, fixture);
    state.connect(bound, () => undefined);
    state.dispatch.setFixture(true);

    await state.testing.readResult(state.atoms.zonesResult);

    expect(fixture.calls).toMatchObject({ sessions: 1, doc: 1, views: 1, zones: 1 });
    expect(live.calls.zones).toBe(0);
```

### 3.4 preact — the explicit `get` waterfall

Judge graft F1. `asyncCompute` hands the body an explicit read-through tracker and a per-run
`AbortSignal`. `awaitAsync(peer, get, abort)` is the waterfall edge. This is the only
post-`await` dependency tracking in the bake-off with a direct empirical proof (probe G), and
it recovers from errors where legend hangs.

```ts
// Wpreact/state-bench/preact/model.ts:89-108
    const sessions = asyncCompute((_get, abort) => host.listSessions(abort));
    const activeDoc = asyncCompute(async (get, abort) => {
      const id = get(session);
      return id ? host.activeDoc(id, abort) : null;
    });
    const views = asyncCompute(async (get, abort) => {
      const sessionId = get(session);
      const docId = get(doc);
      if (!sessionId || !docId) return [];
      await awaitAsync(activeDoc, get, abort);
      return host.listViews(sessionId, docId, abort);
    });
    const zones = asyncCompute(async (get, abort) => {
      const sessionId = get(session);
      const docId = get(doc);
      const viewId = get(view);
      if (!sessionId || !docId || !viewId) return [];
      await awaitAsync(views, get, abort);
      return host.listZones(sessionId, docId, viewId, abort);
    });
```

### 3.5 jotai — `basis` carried, then overwritten

Judge graft F1 and its failure mode in one place. Every feed carries a machine-readable
`basis` key tuple (`store.ts:80`), which is census R3 answered. Then `mark()` sets `state`
from a side `invalidated` set and a side `queryErrors` map, so the basis never decides the
freshness it was built to explain. Graft `basis`; derive `state` **from** it.

```ts
// Wjotai/state-bench/jotai/store.ts:338-348
  const feeds = atom((get) => {
    const stale = get(invalidated);
    const errors = get(queryErrors);
    const mark = <T>(key: string, feed: Feed<T>): Feed<T> => {
      if (errors[key]) {
        return { options: null, state: "error", basis: feed.basis, note: errors[key] };
      }
      return stale.has(key) && feed.options !== null && feed.state !== "error"
        ? { ...feed, state: "stale" }
        : feed;
    };
```

### 3.6 tanstack — `queryOptions` factories

Judge graft F1; synthesis S8. The only place a key is spelled. The write reuses
`zonesOptions(...).queryKey`; the invalidation reuses a prefix built from the same parts.
Census R4 and smells S10 and S12 die on contact with this. Note the cost in the same lines:
the waterfall is `enabled:` configuration, not a tracked dependency — the shape qr-repo R4
rejects.

```ts
// Wtanstack/state-bench/tanstack/model.ts:461-483
  private docOptions(session: string) {
    return queryOptions({
      queryKey: [KEY, "doc", session] as const,
      queryFn: () => this.host.activeDoc(session),
      enabled: session !== "",
    });
  }

  private viewsOptions(session: string, doc: string) {
    return queryOptions({
      queryKey: [KEY, "views", session, doc] as const,
      queryFn: () => this.host.listViews(session, doc),
      enabled: session !== "" && doc !== "",
    });
  }

  private zonesOptions(session: string, doc: string, view: string) {
    return queryOptions({
      queryKey: [KEY, "zones", session, doc, view] as const,
      queryFn: () => this.host.listZones(session, doc, view),
      enabled: session !== "" && doc !== "" && view !== "",
    });
  }
```

### 3.7 xstate — `BINDINGS` + `descendants` + `pickInto`

Judge graft F1; synthesis S1. Plain data and one pure function answer census R2 and R16 for
two independent binding trees, with no effect and no React. The judge said to copy this file
region verbatim.

```ts
// Wxstate/state-bench/xstate/store.ts:35-59
export const BINDINGS: ReadonlyArray<{ key: BindingKey; parent?: BindingKey }> = [
  { key: "session" },
  { key: "doc", parent: "session" },
  { key: "view", parent: "doc" },
  { key: "zones", parent: "view" },
  { key: "folder" },
  { key: "r10", parent: "folder" },
];
const descendants = (key: BindingKey): BindingKey[] => {
  const direct = BINDINGS.filter((binding) => binding.parent === key).map((binding) => binding.key);
  return direct.flatMap((child) => [child, ...descendants(child)]);
};
/** One declarative reset protocol for both URL binding trees. */
export function pickInto(
  search: BenchSearch,
  key: Exclude<BindingKey, "zones">,
  value: string,
): BenchSearch {
  const next = { ...search, [key]: value, zones: [...search.zones] };
  for (const child of descendants(key)) {
    if (child === "zones") next.zones = [];
    else next[child] = "";
  }
  return next;
}
```

### 3.8 legend — the defect that defines the candidate

The library's async authority is a hand-written promise around `onChange`. The settle
predicate needs `started && (error || (isLoaded && !isGetting))`. After an errored read the
predicate never becomes true again, so the third refresh hangs — probe B logged
`refresh3=HUNG`, and the host had already answered. The `synced` getters are also not
reactive, so a URL write does not re-read at all.

```ts
// Wlegend/state-bench/legend/store.ts:311-329
  const refresh = async (key: keyof typeof status) => {
    const status$ = status[key];
    status$.error.set(undefined);
    await new Promise<void>((resolve) => {
      let started = false;
      let stop: (() => void) | undefined;
      const finish = () => {
        const current = status$.peek();
        if (started && (current.error || (current.isLoaded && !current.isGetting))) {
          stop?.();
          resolve();
        }
      };
      stop = status$.onChange(finish);
      void status$.sync();
      started = true;
      finish();
    });
    const error = status$.error.peek();
```

### 3.9 zustand — `settle()` and `retain()`

Judge graft 2; synthesis S10. `settle()` is a deterministic "all reads are idle" await. It
turns a five-case async route test into 107 readable lines, with no fake timers and no
`waitFor`. `retain()` with microtask-deferred disposal survives the Strict Mode double-mount
probe without a `useRef` hack.

```ts
// Wzustand/state-bench/zustand/bench.ts:636-656
    async settle() {
      for (let pass = 0; pass < 20; pass += 1) {
        await Promise.resolve();
        if (queryClient.isFetching({ queryKey: keys.root }) === 0) {
          await Promise.resolve();
          if (queryClient.isFetching({ queryKey: keys.root }) === 0) return;
        }
      }
    },
    retain() {
      retainCount += 1;
      return () => {
        retainCount -= 1;
        queueMicrotask(() => {
          if (retainCount === 0) destroy();
        });
      };
    },
    destroy() {
      destroy();
    },
```

---

## 4. Anti-grafts — named by the judges, do not copy

| Do not copy | Where | Why |
|---|---|---|
| The aggregate `searchAtom` | effect-atom `model.ts:209` | One zone checkbox click re-reads 500 zones twice, plus the doc, the views and the unrelated folder listing. Read the individual param nodes in each async source. |
| `Atom.searchParam` beside a router | effect-atom `model.ts:202-208` | A third URL representation, a module-global singleton, and an undeclared 500 ms `pushState` that fights TanStack Router. S2 says the router owns the URL. |
| `deriveFeed`'s flag-based inference | xstate `store.ts:180-197` | Compute freshness from `basis` and `at`, or delete both fields. |
| The mirror suspense key and the `cacheRevision` counter | tanstack `model.ts:116, 518, 531` | The visible seam between two dependency graphs. Removing that seam is the point of the bake-off. |
| `useModel` | preact `model.ts` / route | It forces React lifecycle code back into the state module. Take `createModel` and the constructor injection; leave the hook. |
| `useShallow` tuple selectors | zustand `view.tsx` | Zustand-specific ergonomic. It does not transfer. |
