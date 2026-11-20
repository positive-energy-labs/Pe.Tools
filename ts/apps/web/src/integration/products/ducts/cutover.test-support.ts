import { FIRM_SEED } from "@pe/ducts-domain/input-layers";
import { fixtureTimeline } from "../../../shell/fixture-work-door.ts";
import * as ductsReads from "@pe/duct-systems-contract/contract";
import { createHash } from "node:crypto";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { ductsDesign } from "@pe/duct-systems-contract/ducts";
import { ductsDocumentSchema } from "@pe/ducts-contract/system-work";
import { fansDocumentSchema } from "@pe/fans-contract/fans";
import { fansCalcData, openFanCalcSchema } from "@pe/fans-contract/fans-read";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import sheet from "../../../../../../products/ducts/web/src/fixtures/fan-sheet.json";
import { snapshot } from "@pe/ducts-domain/test-fixture";
import { placeInput } from "../../../shell/typed-place.test-support.ts";
import type { UseSource } from "@pe/agent-contracts/route";
import { browserWorkPorts, createWorkFeedClient } from "../../../shell/work-feed-client.ts";

import { mountTypedRoute } from "../../../shell/typed-mount.ts";
import { nativeTestAdapter } from "./native.test-support.ts";
import { admitModules } from "../../../../../../products/ducts/web/src/admission.test-support.ts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Calc } from "@pe/fans-contract/fan-calc";
import type { DuctsDesign } from "@pe/duct-systems-contract/ducts";
import type { DuctsFirm } from "@pe/ducts-contract/duct-inputs";
import type { DuctsPricingData } from "@pe/duct-systems-contract/ducts-read";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import type { Catalogs } from "@pe/ducts-domain/catalog";

export interface FixtureDependencies {
  admit: () => Promise<Awaited<ReturnType<typeof admitModules>>>;
  nativeTestAdapter: typeof nativeTestAdapter;
  systemList: (
    snapshot: DuctSnapshot,
    calcs: readonly Calc[] | null,
  ) => DuctsPricingData["analysis"]["systems"];
  pricingValue: (snapshot: DuctSnapshot, calcs: readonly Calc[], design: DuctsDesign) => unknown;
  networkCalcs: (
    snapshot: DuctSnapshot,
    grids: Grids,
    catalogs: Catalogs,
    design: DuctsDesign,
    firm: DuctsFirm,
    revision: number,
  ) => readonly Calc[];
  calcState: (open: ReturnType<typeof openFanCalcSchema.parse>) => unknown;
}

/** The product supplies its implementation; a peer is represented by its public contract fixture. */
export function witnessFactory(dependencies: FixtureDependencies) {
  const { admit, nativeTestAdapter, systemList, pricingValue, networkCalcs, calcState } =
    dependencies;

  return async function createWitness(
    closes: (() => void)[],
    saved = new Map<string, unknown>(),
    overrides: Readonly<Record<string, UseSource>> = {},
    work?: import("../../../shell/typed-place.ts").PlaceInput["work"],
    receipts?: import("@pe/agent-contracts").WorkJournalDoor["receipts"],
    /** The action door; absent, the browser's own. A witness hands in a real host journal here. */
    submit: typeof browserWorkPorts.submit = browserWorkPorts.submit,
    /** The Pe HTTP client the findings history door goes through; absent, the browser's own. */
    findings?: Parameters<
      typeof import("../../../shell/work-feed-client.ts").createTimelineClient
    >[0],
    /** The Readings stream the mount reads the findings Work from; absent, the browser's own. */
    readings?: Pick<import("../../../host/resource-stream.ts").Readings, "subscribe">,
    timeline?: import("../../../shell/work-feed-client.ts").TimelineClient,
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
    // Explicit fixture setup: reading absent production Work never creates it.
    for (const module of [admitted.owner.typed, admitted.presenter.typed]) {
      const state = module.spec.edits!.work;
      if (!saved.has(state.route))
        saved.set(state.route, {
          version: 1,
          schemaVersion: state.schemaVersion ?? 1,
          revision: 0,
          doc: state.schema.parse({}),
        });
    }
    const observe = observeResources(ws, { observe: () => () => {} });
    const calls = new Map<string, number>();
    const inputs = new Map<string, unknown>();
    const connected = createWorkFeedClient(
      { subscribe: observe, dirty() {} },
      {
        write: (key, write) => ws.write(key, key.route, "human", write, async () => []),
        submit: async (command) => {
          const call = `fans:${command.key}`;
          inputs.set(call, command.input);
          calls.set(call, (calls.get(call) ?? 0) + 1);
          return submit(command);
        },
      },
    );
    const feed = {
      ...connected,
      receipts: receipts ?? connected.receipts,
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
    const native: Record<string, UseSource> = {};
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
        works: [],
        trace: [],
        coverage: { requested: [], covered: [], unknown: [], refused: [] },
        freshness: "current",
      },
    });
    for (const [entry, read] of Object.entries({
      [ductsReads.overview.key]: "roster",
      [ductsReads.network.key]: "network",
      [ductsReads.pricing.key]: "pricing",
    })) {
      native[entry] = {
        kind: "use",
        open(_ctx, deliver) {
          let version = 0;
          const send = () => {
            const ductSystemsWork = ductsDocumentSchema.parse(
              (saved.get("duct-systems") as { doc?: unknown })?.doc ?? {},
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
                      ...wire(
                        pricingValue(
                          snapshot,
                          networkCalcs(
                            snapshot,
                            {},
                            {},
                            ductsDesign(ductSystemsWork, fansWork),
                            FIRM_SEED,
                            0,
                          ),
                          ductsDesign(ductSystemsWork, fansWork),
                        ),
                      ),
                      roster,
                      network,
                      fanRows: sheet.roster.rows,
                      ductSystemsWork,
                      fansWork,
                      design: ductsDesign(ductSystemsWork, fansWork),
                      effectiveDesign:
                        withStoredRulings(
                          ductsDesign(ductSystemsWork, fansWork),
                          snapshot.store,
                          snapshot,
                        ) ?? ductsDesign(ductSystemsWork, fansWork),
                      catalogFindings: [],
                      settings: {},
                      // The fixture's criteria as the Fans sheet fixture resolved them, over a stand-in firm file.
                      criteria: sheet.inputs.inputs.criteria,
                      firm: sheet.inputs.firm,
                    };
            deliver({ kind: "complete", revision: ++version, value: packet(data, version) });
          };
          send();
          return ws.subscribeUncaptured(() => {
            deliver({ kind: "stale" });
            queueMicrotask(send);
          });
        },
      };
    }
    native["fans.calc"] = {
      kind: "use",
      async open(ctx, deliver) {
        let version = 0;
        const send = (capture: unknown) => {
          const ductSystemsWork = ductsDocumentSchema.parse(
            (saved.get("duct-systems") as { doc?: unknown })?.doc ?? {},
          );
          const fansWork = fansDocumentSchema.parse(
            (saved.get("fans") as { doc?: unknown })?.doc ?? {},
          );
          const open = openFanCalcSchema.parse({
            overview: sheet.overview,
            inputs: sheet.inputs,
            elements: null,
            legs: null,
            worstLegs: [],
            calcBreakdown: null,
          });
          const data = fansCalcData.parse({
            open,
            opened: [],
            rows: sheet.roster.rows,
            progress: null,
            fans: sheet.roster,
            calcSnapshot: capture,
            calcView: calcState(open),
            ductSystemsWork,
            ductSystemsRevision:
              (saved.get("duct-systems") as { revision?: number } | undefined)?.revision ?? 0,
            settings: {},
            fansWork,
            design: ductsDesign(ductSystemsWork, fansWork),
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
                // Mirror host content identity; reopening a recorded source restarts its frame counter.
                evaluation: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
                inputs: "fixture",
                works: ctx.workKey ? [ctx.workKey, { ...ctx.workKey, route: "duct-systems" }] : [],
                origin: { kind: "fixture", name: "cutover" },
                trace: [],
                coverage: { requested: [], covered: [], unknown: [], refused: [] },
                freshness: "current",
              },
            },
          });
        };
        const capture = overrides["fans.calc-detail-snapshot"];
        let captured: unknown = snapshot;
        const stopCapture =
          capture?.kind === "use" || capture?.kind === "feed"
            ? await capture.open(ctx, (frame) => {
                if (frame.kind === "complete" || frame.kind === "part") {
                  captured = frame.value;
                  send(captured);
                } else if (frame.kind === "failure" || frame.kind === "document-changed")
                  deliver(frame);
              })
            : (send(captured), undefined);
        const stopWork = ws.subscribeUncaptured(() => {
          deliver({ kind: "stale" });
          queueMicrotask(() => send(captured));
        });
        return () => {
          stopCapture?.();
          stopWork();
        };
      },
    };
    const places = new Map<string, ReturnType<typeof placeInput>>();
    function mount(
      route: {
        typed: unknown;
        data: import("@pe/agent-contracts").RouteGraphWire;
        workFingerprint: import("@pe/agent-contracts").RouteFingerprint;
      },
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
      const mounted = nativeTestAdapter(
        mountTypedRoute(
          route.typed as import("@pe/web-kernel/route/typed-route").TypedRoute,
          input,
          route.workFingerprint,
          {
            work: feed,
            timeline: timeline ?? (findings ? undefined : fixtureTimeline(ws)),
            findings,
            readings,
            sources: Object.fromEntries(
              Object.entries({ ...native, ...overrides }).map(([entry, source]) => [
                entry,
                source.kind === "use"
                  ? {
                      ...source,
                      open(ctx, deliver) {
                        const call = `${route.data.key}:${entry}`;
                        calls.set(call, (calls.get(call) ?? 0) + 1);
                        inputs.set(call, ctx.args);
                        return source.open(ctx, deliver);
                      },
                    }
                  : source,
              ]),
            ),
          },
        ),
        feed,
      );
      closes.push(() => mounted.close());
      return mounted;
    }
    const fansMount = mount(admitted.presenter);
    return {
      typed: fansMount.native,
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
  };
}
