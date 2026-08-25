# qr-repo state pattern

Extraction of the per-route state model kaitpw wrote in [kaitpw/qr-repo](https://github.com/kaitpw/qr-repo).
Clone: `.explore/qr-repo` (Deno + Fresh 1.7 + Preact signals 1.2 / signals-core 1.5, tRPC v10, valibot, superjson).
All citations are `path:line` relative to `.explore/qr-repo/`.

The whole thing is **182 lines of library** (`lib/preact.ts`) + **103 lines of URL sync** (`lib/hooks/useSearch.ts`).
It is used by exactly one route at full strength (`islands/ClimateToolPage.tsx`, the climate tool);
`islands/ShortcutsPage.tsx:10` uses the same *class-of-signals* shape without the async half.

---

## 1. The shape

```
                    URL (?superjson-blob)
                          |  useSearch(valibotSchemaWithFallbacks)
                          v
   +--------------------------------------------------------------+
   | class State              (one per route, `const s = new State()`)
   |                                                              |
   |  INPUTS       units  latitude  longitude  stations  ranges   |  Signal<T>   <- url-backed
   |               timeRange                                      |  Signal<T>   <- ephemeral
   |                        |                                     |
   |  SYNC DERIVED   selectedCoordinate = computed(...)           |  Computed<T>
   |                        |                                     |
   |  ASYNC DERIVED  selectedElevation --+  ashraeStations --+    |  Signal<AsyncState<T>>
   |                 openMeteoDataRaw    |        |          |    |
   |                        |            |        v          |    |
   |                        |            |  ashraeMeteoDataRaw    |
   |                        v            +--------+               |
   |                 openMeteoDataStats     ashraeMeteoDataTable   |
   |                                                              |
   |  RULES  constructor { effect(...); effect(...) }  <- cross-field invalidation
   +--------------------------------------------------------------+
                          |  prop `s: S` -- the *whole* object, to every child
                          v
   <TableAshrae s={s}/>  <Map s={s}/>  <HistogramCluster s={s}/>  ...
        each renders via  s.someAsync.value.map({ onLoading, onError, onData })
```

Three rules make the pattern:

| # | Rule | Evidence |
|---|---|---|
| 1 | One plain `class State` per route, constructed in the island body, never in context/store | `islands/ClimateToolPage.tsx:41`, `islands/ShortcutsPage.tsx:50` |
| 2 | The *entire* state object is the only prop; children never receive values | `s: S` in every `components/climate-tool/*.tsx` Props; `export type S = State` at `islands/ClimateToolPage.tsx:508` |
| 3 | Async values are ordinary class fields, declared identically to sync ones | `selectedCoordinate = computed(...)` :289 next to `selectedElevation = asyncCompute(...)` :293 |

### The one snippet

```ts
// islands/ClimateToolPage.tsx:249-336 (elided)
class State {
  constructor() {
    effect(() => { const _ = this.selectedCoordinate.value; this.timeRange.value = 1; });  // :252
    effect(() => { /* clear station selection when the station list changes */ });         // :257
  }

  searchParams = search<v.InferOutput<typeof VSearchParams>>(VSearchParams);  // :276  url <-> signals
  units      = this.searchParams.value.units;        // Signal<"SI"|"IP">
  latitude   = this.searchParams.value.latitude;
  longitude  = this.searchParams.value.longitude;
  timeRange  = signal(1);                                                     // :282  not url-backed

  selectedCoordinate = computed(                                              // :289  sync derived
    () => new Coordinate(this.units, this.latitude.value, this.longitude.value));

  selectedElevation = asyncCompute(async () => {                              // :293  async derived
    const coord = this.selectedCoordinate.value.toObject();                   //       <- tracked (pre-await)
    const data = await trpc.openMeteo.getElevation.query(coord);
    return new Distance(this.units, "SI", data.elevation[0], "small");
  });

  ashraeMeteoDataRaw = asyncCompute(async () => {                             // :319  async -> async
    const stations = await awaitAsync(this.ashraeStations);                   // :321  waterfall edge
    return (await Promise.all(stations.slice(0, 5).map((st) =>
      trpc.ashrae.getMeteoParams.query({ wmo: st.wmo, units: this.units.value }))))
      .map((r) => r.meteo_stations[0]);
  });
}

// consumer -- components/climate-tool/TableAshrae.tsx:14
const data = s.ashraeMeteoDataTable.value.map({
  onLoading: () => null,
  onError: (e) => { console.error(e); return null; },
  onData: (d) => d,
});
if (!data) return null;
```

---

## 2. Primitives the helper offers

`lib/preact.ts`, 182 lines, exports 5 names.

| Primitive | Signature | Notes |
|---|---|---|
| `AsyncState<T>` | base class -- `value: T \| null`, `requireValue: T`, `error: unknown`, `isLoading`, `hasValue`, `hasError` | `:3-41`. Not abstract; base returns loading-ish defaults. `requireValue` throws `:9` |
| `AsyncState#map` | `map<R>({ onLoading: () => R; onError: (e: unknown) => R; onData: (d: T) => R }): R` | `:28-40`. **Exhaustive match, all three arms mandatory.** Checks error -> data -> loading |
| `AsyncData<T>` | `new (value: T)` | `:43` |
| `AsyncLoading<T>` | `new ()` | `:64`. One singleton instance per `asyncCompute` (`:100`) |
| `AsyncError<T>` | `new (error: unknown)` | `:78` |
| `asyncCompute<T>` | `(cb: () => Promise<T>) => Signal<AsyncState<T>>` | `:99-151`. **Not** a hook -- callable anywhere, no React lifecycle |
| `awaitAsync<T>` | `(s: ReadonlySignal<AsyncState<T>>) => Promise<T>` | `:153-180`. Bridges signal-land -> promise-land; how one async state depends on another |

`asyncCompute` internals, one line each:

| Line | Mechanism |
|---|---|
| `:103` | `computed<Promise<T>>(cb)` -- the *promise* is the computed value, so dependency tracking is whatever the async fn reads **before its first `await`** |
| `:141-148` | a single `effect` re-reads `c.value`, aborts the previous `AbortController` with a `reset` symbol, and runs `execute` |
| `:108` | every invalidation immediately sets `s.value = loading` -- no stale-while-revalidate |
| `:115-127` | abort is *logical*: it races the promise against the abort event and drops the loser. The `AbortSignal` is never handed to `fetch`/tRPC |
| `:133-137` | a rejection whose reason is the `reset` symbol lands on `loading`; any other rejection lands on `AsyncError` |

### Borrowed from / omitted vs TanStack Query

| TanStack Query concept | Here |
|---|---|
| `data / error / isPending` discriminated status | yes -- `AsyncState` subclasses, but as a **class hierarchy + exhaustive `map`**, not a status string |
| Dependent queries (`enabled: !!x`) | yes, better -- `await awaitAsync(otherState)` reads as straight-line async code |
| Automatic refetch on input change | yes -- via signal dependency tracking instead of `queryKey` identity |
| Request cancellation | partial -- result-level only; no `AbortSignal` reaches the network (`:115`) |
| `queryKey` / shared cache / dedup across components | **no**. Identity is "this field on this State instance" |
| `staleTime` / `gcTime` / background refetch / `refetchOnWindowFocus` | **no** |
| `retry` / backoff | **no** |
| `placeholderData` / `keepPreviousData` | **no** -- every invalidation flashes to loading |
| Mutations, optimistic updates, invalidation API | **no**. Writes are plain signal assignments (`TableAshrae.tsx:37`) |
| Devtools | **no** |
| Suspense / `useSuspenseQuery` / error boundaries | **no** -- `map` is the hand-rolled equivalent |
| SSR hydration / prefetch / streaming | **no**, deliberately dodged: `IS_BROWSER` early-return at `ClimateToolPage.tsx:38` |
| Infinite / paginated queries | **no** |

Net: it borrows **the status sum type and dependent-query ergonomics**, and omits **the entire cache layer**. That is the whole trade -- see §5.

---

## 3. Waterfalls, mocking, URL

### Async waterfalls -- dependency tracking is real but has a sharp edge

Tracking is automatic, via `computed`. The rule that follows from `computed<Promise<T>>(cb)` at `:103`:

> **Signals read before the first `await` are dependencies. Signals read after it are invisible.**

| Field | Read pre-await (tracked) | Read post-await (untracked) | Consequence |
|---|---|---|---|
| `selectedElevation` :293 | `selectedCoordinate` | -- | correct |
| `ashraeStations` :304 | `selectedCoordinate` | -- | correct |
| `openMeteoDataRaw` :338 | `selectedCoordinate`, `timeRange` :342, `units` :345 (argument literal, evaluated pre-await) | -- | correct -- this is why the "fetch 15 years" button at `TemperatureTimeSeries.tsx:75` works |
| `ashraeMeteoDataRaw` :319 | `ashraeStations` -- because `awaitAsync` reads `.value` synchronously in its Promise executor (`:158`) before returning | **`units` :327** | flipping units does **not** re-request ASHRAE params in the new unit system |
| `ashraeMeteoDataTable` :366 | `selectedElevation` :367 | **`ashraeMeteoDataRaw` :368**, `units` :371 | edge 2 only fires because both upstreams share `selectedCoordinate`; a change to `ashraeMeteoDataRaw` alone would not recompute |
| `openMeteoDataStats` :407 | `openMeteoDataRaw` :408 | `units`, `timeRange` :447 | `timeRange` change is rescued only because `openMeteoDataRaw` also depends on it |

So: **the waterfall edges work by accident of ordering.** Three of six nodes have untracked reads; the graph is currently correct only because the untracked inputs happen to co-invalidate with the tracked ones. `units` correctness is not carried by the state graph at all -- it is carried by the value objects, which capture the `units` signal and convert at render time (`types/climate-tool.ts:161`, `Temperature#toString` :170-181). That is genuinely elegant and genuinely load-bearing: **unit switching is a pure display concern, zero refetch.**

Cross-field invalidation that *isn't* expressible as a derivation goes in constructor `effect`s, which the author calls a "side effect state machine" (`:250`): reset `timeRange` to 1 on any coordinate change (`:252`), and clear the station selection when the station list no longer contains the selected names (`:257-273`). This is the escape hatch for "input depends on derived state", which a pure DAG cannot express.

### Mocking / fixtures

**There are none.** No test file, no mock, no fixture, no `deno test` target beyond the generic line in `CLAUDE.md:8`. `grep -rl "mock\|fixture\|_test\."` over `*.ts|*.tsx` returns empty.

What the pattern *would* need to be mockable:

| Seam | Status |
|---|---|
| `asyncCompute` takes a plain thunk, no key/client coupling | already injectable -- pass any async fn |
| tRPC client is a module-level singleton imported directly by `State` (`ClimateToolPage.tsx:26`, `utils/trpc/trpc.ts:8`) | **not** injected -- mocking requires module interception |
| `State` has a zero-arg constructor | a `constructor(private api = trpc)` would make it a one-liner |
| Failure paths | **mostly unreachable**: the fetchers `try/catch` and return `[]` / `NaN` defaults (`:313-316`, `:356-363`), so `AsyncError` is dead code for 4 of 6 states. Only `ashraeMeteoDataTable` and `openMeteoDataStats` can actually reach `onError` |

### URL state -- `lib/hooks/useSearch.ts`

| Aspect | Behaviour |
|---|---|
| Signature | `useSearch<T>(schema: FallbackSchema<T>, opts = { replace: true }): Signal<{ [K in keyof T]: Signal<T[K]> }>` -- `:28` |
| Schema | valibot object where **every** entry is `v.fallback(...)`, enforced in the type (`:11-17`). Fallbacks double as defaults (`:33-39`) |
| Encoding | **superjson of the whole params object**, URL-encoded into the query string: `?{"json":{...},"meta":{...}}` (`:56-61`, `:80-82`) -- not `k=v` pairs |
| Write | one `effect` reads every inner signal and `replaceState`s (`:73-89`) |
| Read-back | `popstate` listener re-parses and writes into the existing signals (`:92-100`) |
| Degradation | `v.safeParse` failure falls back to *all* defaults (`:61`); per-field `v.fallback` handles individual bad values |
| SSR | separate branch returning default-valued signals, no `location` access (`:42-53`) |
| Not url-backed | `timeRange` (`ClimateToolPage.tsx:282`) -- deliberately ephemeral, and reset by an effect |
| Author's own warning | doc comment `:20-22`: "if a search param unexpectedly resets, there is likely an `effect` listening to a different param and setting the one in question" -- i.e. rule-3 effects fight rule-1 URL state |

---

## 4. Strengths

| # | Strength | Why it matters |
|---|---|---|
| S1 | **Async is not special.** `asyncCompute` is a class field beside `computed`. No hook, no provider, no key, no lifecycle | A new derived value is one field; there is nowhere else to register it |
| S2 | **The whole route model fits on one screen.** `ClimateToolPage.tsx:249-471` is the entire data flow, top to bottom | Highest-value property of the pattern. A human or an agent can answer "where does this number come from" without a graph search |
| S3 | **Waterfalls read as straight-line async.** `await awaitAsync(this.ashraeStations)` beats `enabled: !!stations` plus a second hook | Dependency shape is expressed in the language, not in config |
| S4 | **Exhaustive `map` at every read site.** All three arms are required by the type; you cannot render `undefined` data | This is the discipline TanStack's `data?.` optional chaining loses |
| S5 | **`s: S` as the only prop.** Zero prop plumbing, zero context, zero selector functions | Adding a field costs nothing at any call site |
| S6 | **Units are a display concern, not a fetch concern.** Value objects capture the `units` signal (`climate-tool.ts:161`) | Unit toggle re-renders, never refetches. A cache-keyed approach would refetch |
| S7 | **URL is the source of truth for inputs**, not a mirror synced after the fact (`:276-281`) | Sharing a link reproduces state exactly; no dual-write bug class |
| S8 | **No framework tax.** 285 lines total, no dependency added, works with Preact signals as shipped | |

## 5. Weaknesses and limits

Concrete, each with evidence.

| # | Limit | Evidence / failure mode |
|---|---|---|
| W1 | **Untracked post-`await` reads.** Dependency tracking silently stops at the first `await` | `:327` (`units`), `:368` (`ashraeMeteoDataRaw`), `:447` (`timeRange`). Masked today by co-invalidation; a fourth data source breaks it silently. **No error, no warning -- just a value that stops updating** |
| W2 | **No stale-while-revalidate.** `execute` sets `loading` on every invalidation (`:108`) | Move the map pin -> all three tables render `null` (`TableAshrae.tsx:23`) and the page collapses, then re-expands. There is no `previousData` |
| W3 | **Cancellation is result-level, not network-level.** The `AbortSignal` never reaches `fetch` | `:115-127` only races and discards. Drag the pin 10 times -> 10 in-flight ASHRAE round trips, 9 discarded. On the 15-year OpenMeteo pull that is megabytes |
| W4 | **No dedup or shared cache.** Identity is the field, not a key | Two `State` instances = two identical fetch sets. Navigate away and back -> everything refetches. `selectedElevation` for the same coordinate is never reused |
| W5 | **No retries.** A single flaky response is terminal until an input changes | |
| W6 | **`new State()` in the render body.** `ClimateToolPage.tsx:41`, `ShortcutsPage.tsx:50` -- no `useMemo`, no `useRef`, no module singleton | Survives today only because the island's own JSX reads no signal, so it renders once. Add one `s.units.value` to the island body and every unit toggle constructs a fresh `State`: new `effect`s, new `asyncCompute`s, a full refetch cascade, and **the old ones are never disposed** |
| W7 | **Nothing is ever disposed.** `asyncCompute`'s root `effect` (`:141`) discards its dispose fn; `useSearch`'s `popstate` listener (`:92`) is never removed | Leaks are bounded to one-per-route-instance *given* W6 holds. If W6 breaks, they compound linearly with renders |
| W8 | **`awaitAsync` allocates a fresh `effect` per pending call** (`:169`), disposed only on settle | Each invalidation while an upstream is pending stacks another subscription on that signal. Self-clearing, but transiently unbounded under rapid input |
| W9 | **The error arm is mostly dead.** Fetchers swallow into `[]`/`NaN` (`:313`, `:356`) | The UI cannot distinguish "no stations here" from "ASHRAE is down". Consumers reinforce it: `onError: (e) => { console.error(e); return null }` renders identically to loading (`TableAshrae.tsx:16`) |
| W10 | **No Suspense, no error boundary, no devtools.** Every component hand-writes the three arms | ~14 near-identical `map({onLoading: () => null, onError: ..., onData: (d) => d})` blocks across `components/climate-tool/` |
| W11 | **Loading state is not observable in aggregate.** No `isFetching` count, no "is the page settled" | Components re-derive it locally: `const isLoading = useSignal(true)` then set it inside `map` as a side effect (`HistogramCluster.tsx:24-44`) -- a write during render |
| W12 | **`effect` in the constructor is an imperative back door.** `:252` writes `timeRange` from a derived read | The author's own doc comment (`useSearch.ts:20`) is a bug report about this class of code. Cycles are possible and unguarded |
| W13 | **URL is a superjson blob.** `?{"json":{"units":"IP",...}}` | Not human-editable, not readable by a server handler, not diffable, and `replaceState` on every input change risks Safari/Firefox rate limits |
| W14 | **No SSR story.** Island returns `null` server-side (`:38`) | Zero server-rendered content, no prefetch, no streaming. Fine for this app, not a general answer |
| W15 | **`AsyncState` is not a real sum type.** The base class is concrete and the three subclasses are structurally identical to TS | `map` is a runtime `if` chain (`:33-39`), not exhaustiveness-checked. A fourth state (`refetching`) cannot be added without touching every call site |

---

## 6. Distilled requirements -- what a React 19 replacement must keep

Ordered by how much the pattern's feel depends on it.

| # | Requirement | What it replaces | Non-negotiable? |
|---|---|---|---|
| R1 | Async derived state is declared **the same way** as sync derived state, in the same file, as a peer | `asyncCompute` beside `computed` | **Yes** -- this is the pattern |
| R2 | One route = one **statically readable state module**, all nodes visible together | `class State` | **Yes** |
| R3 | Automatic dependency tracking, no manual key/dep arrays -- **including across `await`** | `computed<Promise<T>>` | **Yes**, and must fix W1 |
| R4 | Dependent async reads as straight-line `await`, not as `enabled:` config | `awaitAsync` | **Yes** |
| R5 | **Exhaustive** loading/error/data match at the read site, statically enforced | `AsyncState#map` | **Yes** -- and should be a real discriminated union (W15) |
| R6 | Consumers take the state object, not values; adding a node costs zero call-site edits | `s: S` prop | Yes |
| R7 | URL-backed inputs with per-field schema + fallback, one declaration | `useSearch` | Yes -- but readable `k=v` encoding (W13) |
| R8 | Escape hatch for input-writes-from-derived-reads (invalidation rules) | constructor `effect`s | Yes -- ideally with cycle detection |
| R9 | Value objects may capture reactive display config (units) so presentation never refetches | `Temperature(unitSignal, ...)` | Yes -- orthogonal to the store, keep it |
| R10 | Zero React lifecycle coupling: state constructible outside a component, testable in a script | `asyncCompute` is not a hook | Yes |
| R11 | Keep-previous-data on invalidation | absent (W2) | **Add** |
| R12 | Real `AbortSignal` threaded to the fetch | absent (W3) | **Add** |
| R13 | Explicit disposal / ownership tied to route lifetime | absent (W6, W7) | **Add** |
| R14 | Errors surface distinctly from empty | absent (W9) | **Add** |
| R15 | Cache/dedup by key | absent (W4) | *Optional* -- costs R9's units-are-free property if done naively. Decide deliberately |
| R16 | Suspense / error-boundary interop | absent (W10) | *Optional* -- R5 is the author's preferred alternative |

---

## 7. Mapping sketch

The same slice in five stacks: url-ish `units` + `coord` inputs -> `elevation` (async) -> `stations` (async) -> `table` (async, depends on both).
Sketches are idiomatic illustrations, not compiled against installed versions.

### effect-atom -- closest match

```ts
import { Atom, Result, useAtomValue } from "@effect-atom/atom-react"
import { Effect } from "effect"

const units = Atom.searchParam("units", { schema: UnitsSchema })   // url-backed
const lat   = Atom.searchParam("lat",   { schema: NumberFromString })
const lng   = Atom.searchParam("lng",   { schema: NumberFromString })
const coord = Atom.make((get) => ({ lat: get(lat), lng: get(lng) }))

const elevation = Atom.make((get) =>
  Api.getElevation(get(coord)).pipe(Effect.map((d) => new Distance(d.elevation[0]))))

const stations = Atom.make((get) => Api.getStations(get(coord)))

const table = Atom.make((get) =>                      // deps tracked across the whole Effect,
  Effect.gen(function* () {                           // not just a sync prefix -- fixes W1
    const elev = yield* get.result(elevation)
    const sts  = yield* get.result(stations)
    return sts.slice(0, 5).map((s) => toRow(s, elev, get(units)))
  }))

// consumer
const view = Result.builder(useAtomValue(table))
  .onInitial(() => null)
  .onFailure((e) => <Err e={e} />)
  .onSuccess((d) => <Table d={d} />)
  .render()
```

Keeps R1-R5, R7, R10 natively. `Result` **is** `AsyncState`; `Result.builder` **is** `.map`. Effect gives R12 (interruption) and R14 (typed errors) free.
Cost: Effect is a whole language, every leaf fetch becomes an `Effect`. R15 needs `Atom.family` + explicit `keepAlive`.

### @tanstack/store + @tanstack/query -- closest to the React default

```ts
import { Store, Derived, useStore } from "@tanstack/store"
import { queryOptions, useQuery } from "@tanstack/react-query"

const inputs = new Store({ units: "IP", lat: 30.253, lng: -97.754 })   // url sync = manual
const coord = new Derived({ deps: [inputs], fn: ({ currDepVals: [i] }) => ({ lat: i.lat, lng: i.lng }) })
coord.mount()

const elevationQ = (c) => queryOptions({ queryKey: ["elev", c],     queryFn: ({ signal }) => api.elev(c, signal) })
const stationsQ  = (c) => queryOptions({ queryKey: ["stations", c], queryFn: ({ signal }) => api.stations(c, signal) })

const tableQ = (c, units) => queryOptions({
  queryKey: ["table", c, units],
  queryFn: async ({ client }) => {                    // dependent fetch inside one query
    const [elev, sts] = await Promise.all([
      client.fetchQuery(elevationQ(c)), client.fetchQuery(stationsQ(c))])
    return sts.slice(0, 5).map((s) => toRow(s, elev, units))
  },
  placeholderData: (prev) => prev,                    // R11
})

function Table() {                                    // read site is a hook, not a field
  const c = useStore(coord)
  const units = useStore(inputs, (s) => s.units)
  const { data, error, isPending } = useQuery(tableQ(c, units))
  if (isPending) return null
  if (error) return <Err e={error} />
  return <T d={data} />
}
```

Wins R11, R12, R15, devtools, retries. **Loses R1/R2/R3** -- the graph is no longer one readable module, it is queryKey strings scattered across hooks with every dependency spelled by hand. Loses R5 (`data` is `T | undefined`, no forced match).

### @legendapp/state v3

```ts
import { observable, syncState } from "@legendapp/state"
import { use$ } from "@legendapp/state/react"
import { synced } from "@legendapp/state/sync"

const s$ = observable({
  units: synced({ get: () => urlParam("units") ?? "IP", set: ({ value }) => setUrlParam("units", value) }),
  lat: 30.253, lng: -97.754,
  coord: (): Coord => ({ lat: s$.lat.get(), lng: s$.lng.get() }),

  elevation: async () => new Distance(await api.elev(s$.coord.get())),   // tracked pre-await only
  stations:  async () => api.stations(s$.coord.get()),                   // -- same W1 edge as qr-repo

  table: async () => {
    const c = s$.coord.get(), units = s$.units.get()                     // read deps FIRST: the workaround
    const [elev, sts] = await Promise.all([s$.elevation.get(), s$.stations.get()])
    return sts.slice(0, 5).map((x) => toRow(x, elev, units))
  },
})

function Table() {
  const data = use$(s$.table)                          // undefined until resolved
  const { isLoaded, error } = use$(syncState(s$.table)) // status is a *sibling* observable
  if (error) return <Err e={error} />
  if (!isLoaded) return null
  return <T d={data} />
}
```

Closest *structurally*: one object literal, functions-as-computeds, async computeds as peers -- R1, R2, R4, R6, R10 kept, R7 via `synced`. **Same W1 footgun**, and R5 is lost: status lives in a parallel `syncState` observable rather than in the value, so nothing forces you to handle it.

### jotai

```ts
import { atom, useAtomValue } from "jotai"
import { loadable } from "jotai/utils"
import { atomWithLocation } from "jotai-location"

const loc   = atomWithLocation()
const units = atom((get) => get(loc).searchParams?.get("units") ?? "IP",
                   (_g, set, v) => set(loc, (p) => ({ ...p, searchParams: new URLSearchParams({ units: v }) })))
const coord = atom((get) => ({ lat: Number(get(loc).searchParams?.get("lat")), lng: /* ... */ 0 }))

const elevationA = atom(async (get) => new Distance(await api.elev(get(coord), { signal: get.signal })))
const stationsA  = atom(async (get) => api.stations(get(coord), { signal: get.signal }))

const tableA = atom(async (get) => {
  const u = get(units)                                          // sync reads still precede awaits (W1),
  const [elev, sts] = await Promise.all([get(elevationA), get(stationsA)])  // but get() itself IS tracked
  return sts.slice(0, 5).map((s) => toRow(s, elev, u))
})
const tableL = loadable(tableA)                                 // opt out of Suspense -> Result-like

function Table() {
  const r = useAtomValue(tableL)                                // { state: "loading"|"hasError"|"hasData" }
  switch (r.state) {
    case "loading":  return null
    case "hasError": return <Err e={r.error} />
    case "hasData":  return <T d={r.data} />
  }
}
```

`loadable`'s `{state}` union is the nearest thing to `AsyncState` in mainstream React -- R5 survives as a `switch`. R3/R4 good (`get()` inside async atoms is tracked). R12 free via `get.signal`. **R2 weakens**: atoms are module-level free variables, not a route object; per-route instancing needs `Provider` scopes or `atomFamily`.

### zustand -- the honest floor

```ts
import { create } from "zustand"

type Async<T> = { status: "loading" } | { status: "error"; error: unknown } | { status: "data"; data: T }
const L = { status: "loading" } as const

const useS = create<S>((set, get) => ({
  units: "IP", lat: 30.253, lng: -97.754, ac: null as AbortController | null,
  elevation: L as Async<Distance>, stations: L as Async<Station[]>, table: L as Async<Row[]>,

  setCoord: (lat, lng) => { set({ lat, lng }); get().refetch() },   // invalidation is MANUAL

  refetch: async () => {                                            // one hand-rolled waterfall
    get().ac?.abort()
    const ac = new AbortController()
    set({ ac, elevation: L, stations: L, table: L })
    try {
      const [elev, sts] = await Promise.all([
        api.elev(get(), { signal: ac.signal }), api.stations(get(), { signal: ac.signal })])
      if (ac.signal.aborted) return
      set({ elevation: { status: "data", data: elev }, stations: { status: "data", data: sts },
            table: { status: "data", data: sts.slice(0, 5).map((s) => toRow(s, elev, get().units)) } })
    } catch (error) { if (!ac.signal.aborted) set({ table: { status: "error", error } }) }
  },
}))

function Table() {                                    // R5 survives, hand-written
  const t = useS((s) => s.table)
  return t.status === "loading" ? null : t.status === "error" ? <Err e={t.error} /> : <T d={t.data} />
}
```

Keeps R2, R5, R6, R10 and gets R12 by hand. **Loses R1 and R3 entirely** -- no derived-state primitive at all, so every edge in the graph is a line of imperative invalidation code you maintain. This is what the pattern looks like *without* `asyncCompute`, and it is the argument for the pattern.

### Verdict

| Stack | R1 async=sync | R2 one module | R3 track across await | R4 straight-line deps | R5 exhaustive | R7 url | R11 keep-prev | R12 abort | R15 cache |
|---|---|---|---|---|---|---|---|---|---|
| qr-repo today | yes | yes | **no** (W1) | yes | yes | yes | no | no | no |
| effect-atom | yes | yes | yes | yes | yes | yes | manual | yes | family |
| tanstack store+query | no | no | n/a manual | in-query | no | manual | yes | yes | yes |
| legend v3 | yes | yes | **no** | yes | no | yes | partial | no | partial |
| jotai | yes | partial | yes | yes | yes (`loadable`) | plugin | no | yes | family |
| zustand | no | yes | manual | no | hand-written | no | manual | yes | no |

**effect-atom** is the only option that keeps every requirement the pattern is *about* (R1-R5) while fixing W1, W3 and W14. **jotai + `loadable`** is the cheap replacement that keeps the feel and gives up R2. **tanstack query** buys the cache layer at the cost of the thing kaitpw actually likes here -- the one-screen, statically-readable route graph.
