import { useSyncExternalStore } from "react";
import { cleanup, waitFor } from "@testing-library/react";
import { expect } from "vite-plus/test";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import type { Readings } from "../host/resource-stream";
import {
  bindWork,
  commands,
  workFingerprintSchema,
  actionReceiptSchema,
} from "@pe/agent-contracts";
import type {
  WorkJournalDoor,
  AcceptedResult,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { bindControl } from "../../../host/src/control";
import { testConsents } from "../../../host/tests/effect-test";
import { fixture, ref, path, gate } from "../../../host/tests/host-read-graph.test-support";
import { createWorkFeedClient } from "../shell/work-feed-client";
import { completion } from "../shell/work-door-observation";
import { mountTypedRoute, type TypedMount } from "../shell/typed-mount";
import type { UseSource } from "../shell/source-contract";
import { builtinRouteStamp } from "../route/builtin-inventory";
import { module, viewCatalogue } from "./route";
import { AdoptionBody } from "./typed-adoption";
import { module as familiesModule } from "../families/route";

// Real HTTP read graph, disk captures and Work. Only the native boundary and router are recorded.
export async function journey(options: { catalogue?: ReturnType<typeof gate>; snapshot?: ReturnType<typeof gate>; start?: boolean; route?: "families" } = {}) {
  const selectedModule = options.route === "families" ? familiesModule : module;
  let carriers = "needs-initialization";
  let catalogueState: "views" | "empty" | "failed" = "views";
  let catalogueHold = options.catalogue;
  const nativeCalls: { key: string; input: unknown }[] = [];
  const nativeScopes: unknown[] = [];
  const actions: { key: string; input: Record<string, unknown> }[] = [];
  bindControl({runs:testConsents(() => {}), acquired:() => null});
  const host = await fixture(true, {
    actions: true,
    inventory: {
      sessions: [
        {
          sessionId: ref.session,
          connected: true,
          openDocumentCount: 1,
          openDocuments: [
            { ...ref, title: "Chadds", address: path, isActive: true, isFamilyDocument: false },
          ],
        },
      ],
    },
    async read(input) {
      nativeCalls.push({ key: input.key, input: input.input });
      nativeScopes.push(input.scope);
      if (input.key === "revit.catalog.loaded-families") {
        if (catalogueHold) {
          catalogueHold.entered.resolve();
          await catalogueHold.release.promise;
          catalogueHold = undefined;
        }
        return {
          summary: { totalFamilies: 1, placedFamilies: 0, unplacedFamilies: 1, totalTypes: 1, totalPlacedInstances: 0, truncated: false },
          families: [{ familyId: 1, familyUniqueId: "air-tag", familyName: "Air Terminal Tag", categoryName: "Air Terminal Tags", typeCount: 1, placedInstanceCount: 0, types: [{ typeName: "Standard" }] }],
          issues: [],
        };
      }
      if (input.key === "revit.catalog.project-index") {
        const hold = catalogueHold;
        if (hold) {
          hold.entered.resolve();
          await hold.release.promise;
          if (catalogueHold === hold) catalogueHold = undefined;
        }
        if (catalogueState === "failed") throw Error("View catalogue refused: project index unavailable");
        return {
          summary: {
            levelCount: 0,
            sheetCount: 0,
            viewCount: catalogueState === "empty" ? 0 : 1,
            scheduleCount: 0,
            categoryCount: 0,
            familyCount: 0,
            truncated: false,
          },
          levels: [],
          sheets: [],
          schedules: [],
          categories: [],
          families: [],
          browserOrganizations: [],
          issues: [],
          views: catalogueState === "empty" ? [] : [
            {
              handle: { kind: "View", documentKey: path, elementId: 11, label: "Zoning plan" },
              name: "Zoning plan",
              viewType: "FloorPlan",
              levelName: "Level 1",
              isTemplate: false,
              canBePrinted: true,
              isPlacedOnSheet: false,
              sheetHandles: [],
              browserPaths: [],
              provenance: [],
            },
          ],
        };
      }
      if (input.key === "takeoffs.snapshot") {
        if (options.snapshot) {
          options.snapshot.entered.resolve();
          await options.snapshot.release.promise;
        }
        return {
          reading: { at: path, version: null, observedAt: "2026-11-07T00:00:00.000Z" },
          snapshot: {
            status: {
              systems: [],
              carriers: { stage: "Adoption", status: carriers, missingCarrierGuids: [] },
            },
            zoneFrs: [],
            regionsByZone: {},
          },
        };
      }
      if (input.key === "takeoffs.candidates")
        return {
          regions: [
            {
              elementId: 21,
              typeName: "Office zone",
              view: "Zoning plan",
              color: "10,20,30",
              sqft: 100,
              blob: "",
              loops: [
                [
                  [0, 0],
                  [10, 0],
                  [10, 10],
                  [0, 10],
                ],
              ],
            },
          ],
        };
      throw Error(`Unexpected native read ${input.key}`);
    },
  });
  const key = bindWork(selectedModule.spec.key, path, undefined, ref);
  let generation = 0;
  const pending = new Set<Promise<unknown>>(),
    listeners = new Set<() => void>();
  const source = (read: string): UseSource => ({
    kind: "use",
    open(ctx, deliver) {
      let closed = false, version = 0;
      const refresh = () => {
        const mine = ++version;
        const stamp = ++generation;
        deliver({ kind: "stale" });
        const task = host
          .probe({
            read,
            args: { ...(ctx.args as object), target: options.route === "families" ? ref : { kind: "document", ref } },
            subscription: `takeoffs-${stamp}`,
            generation: stamp,
          })
          .then(async (response) => {
            if (!response.ok) throw Error(await response.text());
            const packet = await response.json();
            if (!closed && !ctx.signal.aborted && mine === version)
              deliver({ kind: "complete", value: packet, revision: stamp });
          })
          .catch((error) => {
            if (!closed && !ctx.signal.aborted && mine === version) deliver({ kind: "failure", error });
          });
        pending.add(task);
        void task.finally(() => pending.delete(task));
      };
      listeners.add(refresh);
      refresh();
      return () => {
        closed = true;
        listeners.delete(refresh);
      };
    },
  });
  const first = host.probe({
    read: options.route === "families" ? "families.view" : "takeoffs.adoption",
    args: options.route === "families" ? { target: ref } : { views: [], zones: [], work: "", target: { kind: "document", ref } },
    subscription: "setup",
    generation: 0,
  });
  pending.add(first);
  void first.finally(() => pending.delete(first));
  if (options.catalogue) await Promise.race([
    options.catalogue.entered.promise,
    first.then(async response => { throw Error(`Read finished before the catalogue hold: ${await response.text()}`); }),
  ]);
  else {
    const response = await first;
    expect(response.status, await response.clone().text()).toBe(200);
  }
  const stopWork = host.workspace.subscribeUncaptured(() => listeners.forEach((f) => f()));
  const streams = new Set<() => void>();
  const readings: Readings = {
    subscribe(reading, deliver) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, closed = false;
      const stop = () => { closed = true; void reader?.cancel(); streams.delete(stop); };
      streams.add(stop);
      void (async () => {
        const url = new URL(peRouteUrl("resources.stream", {}), "http://host");
        url.searchParams.set("keys", JSON.stringify([reading]));
        const response = await host.request(new Request(url));
        reader = response.body!.getReader();
        if (closed) return void reader.cancel();
        let buffer = "";
        const decoder = new TextDecoder();
        while (!closed) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            for (const line of frame.split("\n")) if (line.startsWith("data: ")) { deliver(JSON.parse(line.slice(6))); }
          }
        }
      })();
      return stop;
    }, dirty() {},
  };
  const feed = createWorkFeedClient(
    readings,
    {
      write: (key, write) => host.workspace.write(key, key.route, "human", write),
      submit: async command => {
        const response = await host.request(new Request("http://host/actions", {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(command)}));
        expect([200,202],await response.clone().text()).toContain(response.status);
        await host.journal.wait(command.id);
        return actionReceiptSchema.parse((await host.journal.list(undefined,command.id))[0]);
      },
    },
  );
  const work: WorkJournalDoor = {
    ...feed,
    submit(command) {
      if(command.key === "work.start") return feed.submit(command);
      actions.push({ key: command.key, input: command.input });
      if (command.key === "takeoffs.initialize") carriers = "ready";
      const result =
        command.key === commands["takeoffs.adopt"].writeBoundary.previewKey
          ? {
              previewOnly: true,
              derivedRequest: {},
              seal: {
                caller: { kind: "human", via: "local" },
                requestHash: "recorded",
                work: { handle: command.input.work },
                documentMark: { ...ref, observedSince: 1, changedAt: 10 },
                incarnation: null,
                dependencies: "recorded",
              },
            }
          : {};
      return {
        lifetime: "command",
        key: command.key,
        handle: { lifetime: "command", id: command.id as never, causalParent: command.id as never },
        accepted: completion<AcceptedResult>({ kind: "pending" }, async () => ({
          kind: "accepted-native",
          receiptId: command.id,
          outcome: "committed",
          result,
        })),
      };
    },
  };
  let search = new URLSearchParams();
  const mount = mountTypedRoute(
    selectedModule,
    {
      fixture: null,
      target: { kind: "document", ref },
      work: { address: path, open: ref },
      custody: { current: () => true },
      memory: () => ({}),
      address: {
        read: () => new URLSearchParams(search),
        write(next) {
          search = new URLSearchParams(next);
        },
        subscribe: () => () => {},
      },
    },
    workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp(options.route ?? "takeoffs")}`),
    { work, sources: { "takeoffs.adoption": source("takeoffs.adoption"), "takeoffs.views": source("takeoffs.views"), "families.view": source("families.view") } },
  );
  const stop = mount.subscribe(() => {});
  await waitFor(() => expect(mount.startAction()).not.toBeNull());
  if (options.start !== false) await mount.startAction()!.run();
  return {
    host,
    mount,
    actions,
    nativeCalls,
    nativeScopes,
    key,
    rereadCatalogue(state: typeof catalogueState, hold?: ReturnType<typeof gate>) {
      catalogueState = state;
      catalogueHold = hold;
      host.changed();
      listeners.forEach((refresh) => refresh());
    },
    ready: () =>
      waitFor(
        () => {
          const value = mount.value();
          expect(value.current, value.current ? "" : value.reason).toBe(true);
          if (!options.route) expect(mount.value(viewCatalogue).current).toBe(true);
          expect(mount.workBasis()).toBeTruthy();
        },
        { timeout: 20000 },
      ),
    async close() {
      options.catalogue?.release.resolve();
      options.snapshot?.release.resolve();
      catalogueHold?.release.resolve();
      cleanup();
      stop();
      mount.dispose();
      stopWork();
      await Promise.allSettled([...pending]);
      for (const stop of streams) stop();
      await host.close();
    },
  };
}
export function Drawing({ mount }: { mount: TypedMount }) {
  useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
  return mount.draw("adoption", (ctx) => <AdoptionBody ctx={ctx} />) as React.ReactNode;
}
