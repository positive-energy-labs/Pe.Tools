import { systemList } from "@pe/ducts-domain/system-list";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { pricingResult } from "@pe/ducts-domain/pricing-result";
import { ductsDesign, ductsDocumentSchema, fansDocumentSchema } from "@pe/agent-contracts";
import {
  fansSheetData,
  openFanSheetSchema,
} from "../../../../packages/agent-contracts/src/fans-read.ts";
import { sheetState } from "../ducts/sheet/state.ts";
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
  const inputs = new Map<string, unknown>();
  const native: Record<string, ReadingSource> = {};
  const wire = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (_key, value) =>
        value instanceof Map
          ? Object.fromEntries(value)
          : value instanceof Set
            ? [...value]
            : value,
      ),
    );
  const packet = (data: unknown, version: number) => ({
    key: "fixture",
    generation: 0,
    version,
    state: "current",
    value: {
      data,
      evaluation: `fixture:${version}`,
      inputs: "fixture",
      origin: { kind: "fixture", name: "cutover" },
      trace: [],
      coverage: { requested: [], covered: [], unknown: [], refused: [] },
      freshness: "current",
    },
  });
  for (const [entry, read] of Object.entries({
    "ducts.roster.value": "roster",
    "ducts.network.value": "network",
    "ducts.pricing.value": "pricing",
  })) {
    native[entry] = {
      kind: "use",
      open(_ctx, deliver) {
        let version = 0;
        const send = () => {
          const ductsWork = ductsDocumentSchema.parse(
            (saved.get("ducts") as { doc?: unknown })?.doc ?? {},
          );
          const fansWork = fansDocumentSchema.parse(
            (saved.get("fans") as { doc?: unknown })?.doc ?? {},
          );
          const network = {
            ...snapshot,
            sourceVersion: "fixture",
            systemReads: { completed: snapshot.systems.map((system) => system.id), missing: [] },
          };
          const roster = {
            ...snapshot,
            rows: systemList(snapshot, null),
            sourceVersion: "fixture",
          };
          const data =
            read === "roster"
              ? roster
              : read === "network"
                ? network
                : {
                    ...wire(pricingResult(snapshot, {}, {}, ductsDesign(ductsWork, fansWork))),
                    roster,
                    network,
                    fanRows: sheet.roster.rows,
                    ductsWork,
                    fansWork,
                    design: ductsDesign(ductsWork, fansWork),
                    effectiveDesign:
                      withStoredRulings(ductsDesign(ductsWork, fansWork), snapshot.store) ??
                      ductsDesign(ductsWork, fansWork),
                    catalogFindings: [],
                  };
          deliver({ kind: "complete", revision: ++version, value: packet(data, version) });
        };
        send();
        return ws.subscribe(() => {
          deliver({ kind: "stale" });
          queueMicrotask(send);
        });
      },
    };
  }
  native["fans.sheet"] = {
    kind: "use",
    async open(ctx, deliver) {
      let version = 0;
      const send = (capture: unknown) => {
        const ductsWork = ductsDocumentSchema.parse(
          (saved.get("ducts") as { doc?: unknown })?.doc ?? {},
        );
        const fansWork = fansDocumentSchema.parse(
          (saved.get("fans") as { doc?: unknown })?.doc ?? {},
        );
        const open = openFanSheetSchema.parse({
          overview: sheet.overview,
          inputs: sheet.inputs,
          elements: null,
          legs: null,
          worstLegs: [],
          worksheet: null,
        });
        const data = fansSheetData.parse({
          open,
          opened: [],
          rows: sheet.roster.rows,
          progress: null,
          fans: sheet.roster,
          sheetSnapshot: capture,
          sheetView: sheetState(open),
          ductsWork,
          fansWork,
          design: ductsDesign(ductsWork, fansWork),
        });
        deliver({
          kind: "complete",
          revision: ++version,
          value: {
            key: "fixture",
            generation: 0,
            version,
            state: "current",
            value: {
              data,
              evaluation: `fixture:${version}`,
              inputs: "fixture",
              origin: { kind: "fixture", name: "cutover" },
              trace: [],
              coverage: { requested: [], covered: [], unknown: [], refused: [] },
              freshness: "current",
            },
          },
        });
      };
      const capture = overrides["ducts.sheet-snapshot"];
      let captured: unknown = snapshot;
      const stopCapture =
        capture?.kind === "use" || capture?.kind === "feed"
          ? await capture.open(ctx, (frame) => {
              if (frame.kind === "complete" || frame.kind === "part") {
                captured = frame.value;
                send(captured);
              }
            })
          : (send(captured), undefined);
      const stopWork = ws.subscribe(() => {
        deliver({ kind: "stale" });
        queueMicrotask(() => send(captured));
      });
      return () => {
        stopCapture?.();
        stopWork();
      };
    },
  };
  const baseServices = sourceRouteServices({ ...native, ...overrides });
  const services: typeof baseServices = {
    ...baseServices,
    work: feed,
    reads: {
      ...baseServices.reads,
      acquire(request, token) {
        const call = `${request.route.data.key}:${request.key.op}`;
        calls.set(call, (calls.get(call) ?? 0) + 1);
        inputs.set(call, JSON.parse(request.key.sortedKeyInput));
        return baseServices.reads.acquire(request, token);
      },
    },
  };
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
        target: { kind: "document", ref: work?.open ?? { session: "fixture", openId: "fans" } },
        ...(work ? { work } : {}),
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
    inputs,
    saved,
    ws,
    mount,
    places,
    owner: mount(admitted.owner),
    fans: mount(admitted.presenter),
  };
}
