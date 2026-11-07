import { ductsDesign, ductsDocumentSchema, fansDocumentSchema } from "@pe/agent-contracts";
import { fansSheetData, openFanSheetSchema } from "../../../../packages/agent-contracts/src/fans-read.ts";
import { sheetState } from "../ducts/sheet/state.ts";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-module";
import sheet from "../ducts/sheet/sheet.fixture.json";
import { snapshot } from "../ducts/test-fixture";
import { createRouteShell } from "../shell/admitted-mount";
import { placeInput } from "../shell/admitted-place.test-fixture";
import type { ReadingSource } from "../shell/readings";
import { sourceRouteServices } from "../shell/source-route-services";
import { browserWorkPorts, createWorkFeedClient } from "../shell/work-feed-client";

import { mountTypedRoute } from "../shell/typed-mount";
import { nativeTestAdapter } from "./native.test-support";
import { admit } from "./admission.fixture";

export async function createWitness(
  closes: (() => void)[],
  saved = new Map<string, unknown>(),
  overrides: Readonly<Record<string, ReadingSource>> = {},
  work?: import("../shell/admitted-place").PlaceInput["work"],
) {
  const admitted = await admit();
  const ws = new RouteWorkspace({
    registrations: [],
    store: {
      getState: async ({ route }) => saved.get(route),
      setState: async ({ route, value }) => {
        saved.set(route, structuredClone(value));
      },
      listState: async () => ({ records: [], truncated: false, unreadable: 0, unindexed: 0 }),
    },
  });
  for (const host of [admitted.hostOwner, admitted.hostPresenter]) {
    const registration = ws.registerAdmitted(host);
    await registration.ready;
    closes.push(() => registration.close());
  }
  const observe = observeResources(ws, { observe: () => () => {} });
  const calls = new Map<string, number>();
  const inputs = new Map<string, unknown>();
  const connected = createWorkFeedClient(
    { subscribe: observe, dirty() {} },
    {
      write: (key, write) => ws.write(key, key.route, "human", write),
      submit: async command => { const call = `fans:${command.key}`; inputs.set(call,command.input); calls.set(call,(calls.get(call)??0)+1); return browserWorkPorts.submit(command); },
    },
  );
  const feed = {
    ...connected,
    open: (scope: Parameters<typeof connected.open>[0]) => ({
      subscribe: (
        deliver: Parameters<ReturnType<typeof connected.open>["subscribe"]>[0],
        end: () => void,
      ) =>
        connected.open(scope).subscribe((state) => {
          deliver(
            process.env.PE_FANS_MUTATION === "history" && state.kind === "ready"
              ? { ...state, history: { acks: [], from: state.snapshot.revision + 1 } }
              : state,
          );
        }, end),
    }),
  };
  const native: Record<string, ReadingSource> = {};
  for (const [entry, value] of Object.entries({
    "ducts.roster": snapshot,
    "ducts.networks": snapshot,
    "ducts.tables": {},
    "ducts.catalogs": { tables: {}, findings: [] },
    "ducts.fans": sheet.roster,
    "ducts.sheet": {
      open: {
        overview: sheet.overview,
        inputs: sheet.inputs,
        elements: null,
        legs: null,
        worstLegs: [],
        worksheet: null,
      },
      opened: [],
      rows: sheet.roster.rows,
      progress: null,
    },
    "ducts.sheet-snapshot": snapshot,
  }))
    native[entry] = {
      kind: "use",
      open(_ctx, deliver) {
        deliver({ kind: "complete", value, revision: 1 });
      },
    };
  native["fans.sheet"] = { kind: "use", open(ctx, deliver) {
    let version = 0;
    const send = (capture: unknown) => {
      const ductsWork = ductsDocumentSchema.parse((saved.get("ducts") as { doc?: unknown })?.doc ?? {});
      const fansWork = fansDocumentSchema.parse((saved.get("fans") as { doc?: unknown })?.doc ?? {});
      const open = openFanSheetSchema.parse({ overview: sheet.overview, inputs: sheet.inputs, elements: null, legs: null, worstLegs: [], worksheet: null });
      const data = fansSheetData.parse({ open, opened: [], rows: sheet.roster.rows, progress: null,
        fans: sheet.roster, sheetSnapshot: capture, sheetView: sheetState(open),
        ductsWork, fansWork, design: ductsDesign(ductsWork, fansWork) });
      deliver({ kind: "complete", revision: ++version, value: { key: "fixture", generation: 0, version, state: "current",
        value: { data, evaluation: `fixture:${version}`, inputs: "fixture", origin: { kind: "fixture", name: "cutover" }, trace: [],
          coverage: { requested: [], covered: [], unknown: [], refused: [] }, freshness: "current" } } });
    };
    const capture = overrides["ducts.sheet-snapshot"];
    let current: unknown = snapshot;
    const stop = capture?.kind === "use" || capture?.kind === "feed" ? capture.open(ctx, frame => {
      if (frame.kind === "complete" || frame.kind === "part") { current=frame.value; send(current); }
    }) : (send(current), undefined);
    const unsubscribe=ws.subscribe(() => { deliver({ kind: "stale" }); queueMicrotask(() => send(current)); });
    return () => { unsubscribe(); void Promise.resolve(stop).then(close=>close?.()); };
  } };
  const baseServices = sourceRouteServices({ ...native, ...overrides });
  const services: typeof baseServices = { ...baseServices, work: feed, reads: {
    ...baseServices.reads,
    acquire(request, token) {
      const call = `${request.route.data.key}:${request.key.op}`;
      calls.set(call, (calls.get(call) ?? 0) + 1);
      inputs.set(call, JSON.parse(request.key.sortedKeyInput));
      return baseServices.reads.acquire(request, token);
    },
  } };
  const places = new Map<string, ReturnType<typeof placeInput>>();
  function mount(
    route: AdmittedRoute | Awaited<ReturnType<typeof admit>>["presenter"],
    initial = new URLSearchParams(),
    place: string = route.data.key,
  ) {
    let input = places.get(place);
    if (!input) {
      let search = new URLSearchParams(initial);
      const listeners = new Set<() => void>();
      const address = {
        read: () => new URLSearchParams(search),
        write: (next: URLSearchParams) => {
          if (next.toString() === search.toString()) return;
          search = new URLSearchParams(next);
          for (const notify of listeners) notify();
        },
        subscribe: (notify: () => void) => {
          listeners.add(notify);
          return () => {
            listeners.delete(notify);
          };
        },
      };
      input = placeInput(address, {
        target: { kind: "document", ref: work?.open ?? { session: "fixture", openId: "fans" } },
        ...(work ? { work } : {}),
      });
      places.set(place, input);
    }
    const mounted = "typed" in route ? nativeTestAdapter(mountTypedRoute(route.typed, input, route.workFingerprint, {work: feed, sources: Object.fromEntries(Object.entries({...native,...overrides}).map(([entry,source])=>[entry, source.kind === "use" ? { ...source, open(ctx,deliver) {
      const call = `fans:${entry}`; calls.set(call,(calls.get(call)??0)+1); inputs.set(call,ctx.args);
      return source.open(ctx,deliver);
    } } : source])) }), feed) : createRouteShell(services).mount(route, input);
    closes.push(() => mounted.close());
    return mounted as Omit<import("../shell/admitted-mount").AdmittedMount, "page" | "controls"> & {
      page: { read(): any; pose(patch: Record<string,unknown>, intent?: string): any; select(value: any): any; set(...args:any[]):any; device(...args:any[]):any; transient(...args:any[]):any };
      controls: { query(key:string,value:unknown):any; subject(value:any):any; stage(...args:any[]):any; draft(...args:any[]):any; device(...args:any[]):any; transient(...args:any[]):any };
    };
  }
  const fansMount=mount(admitted.presenter);
  return {
    typed: (fansMount as ReturnType<typeof nativeTestAdapter>).native,
    admitted,
    calls,
    inputs,
    saved,
    ws,
    mount,
    places,
    owner: mount(admitted.owner),
    fans: fansMount,
  };
}
