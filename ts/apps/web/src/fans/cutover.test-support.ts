import { RouteWorkspace, observeResources } from "@pe/runtime";
import type { EntryTable } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { SchemaTable } from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-module";
import sheet from "../ducts/sheet/sheet.fixture.json";
import { snapshot } from "../ducts/test-fixture";
import { createRouteShell } from "../shell/admitted-mount";
import { placeInput } from "../shell/admitted-place.test-fixture";
import type { ReadingSource } from "../shell/readings";
import { sourceRouteServices } from "../shell/source-route-services";
import { createWorkFeedClient } from "../shell/work-feed-client";

import { admit } from "./admission.fixture";

export async function createWitness(
  closes: (() => void)[],
  saved = new Map<string, unknown>(),
  overrides: Readonly<Record<string, ReadingSource>> = {},
) {
  const admitted = await admit();
  const ws = new RouteWorkspace({
    registrations: [],
    store: {
      getState: async ({ route }) => saved.get(route),
      setState: async ({ route, value }) => {
        saved.set(route, structuredClone(value));
      },
      // Ducts Work declares a 1 -> 2 migration, so admission takes a census; every Work this
      // witness saves is born at the current schema age, so none is older.
      listState: async () => ({ records: [], truncated: false, unreadable: 0, unindexed: 0 }),
    },
  });
  for (const host of [admitted.hostOwner, admitted.hostPresenter]) {
    const registration = ws.registerAdmitted(host);
    await registration.ready;
    closes.push(() => registration.close());
  }
  const observe = observeResources(ws, { observe: () => () => {} });
  const connected = createWorkFeedClient(
    { subscribe: observe, dirty() {} },
    {
      write: (key, write) => ws.write(key, key.route, "human", write),
      submit: async () => {
        throw Error("Native writes require the sealed-review fixture");
      },
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
  const calls = new Map<string, number>();
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
  const baseServices = sourceRouteServices({ ...native, ...overrides });
  const services: typeof baseServices = { ...baseServices, work: feed, reads: {
    ...baseServices.reads,
    acquire(request, token) {
      const call = `${request.route.data.key}:${request.key.op}`;
      calls.set(call, (calls.get(call) ?? 0) + 1);
      return baseServices.reads.acquire(request, token);
    },
  } };
  const places = new Map<string, ReturnType<typeof placeInput>>();
  function mount<G extends RouteGraphJson, S extends SchemaTable, E extends EntryTable, R>(
    route: AdmittedRoute<G, S, E, R>,
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
        target: { kind: "document", ref: { session: "fixture", openId: "fans" } },
      });
      places.set(place, input);
    }
    const mounted = createRouteShell(services).mount(route, input);
    closes.push(mounted.close);
    return mounted;
  }
  return {
    admitted,
    calls,
    saved,
    ws,
    mount,
    places,
    owner: mount(admitted.owner),
    fans: mount(admitted.presenter),
  };
}
