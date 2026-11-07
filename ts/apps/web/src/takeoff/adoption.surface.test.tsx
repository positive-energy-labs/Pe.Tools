// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { join } from "node:path";
import { observeResources } from "@pe/runtime";
import {
  bindWork,
  commands,
  workKey,
  takeoffsRouteState,
  workFingerprintSchema,
} from "@pe/agent-contracts";
import type {
  WorkJournalDoor,
  AcceptedResult,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { fixture, ref, path } from "../../../host/tests/host-read-graph.test-support";
import { fileRouteDocumentStore } from "../../../host/src/route-document-store";
import { adoptionData } from "../../../../packages/agent-contracts/src/takeoff-read";
import { createWorkFeedClient } from "../shell/work-feed-client";
import { completion } from "../shell/work-door-observation";
import { mountTypedRoute, type TypedMount } from "../shell/typed-mount";
import type { UseSource } from "../shell/source-contract";
import { builtinRouteStamp } from "../route/builtin-inventory";
import { module, loaded } from "./route";
import { AdoptionBody } from "./typed-adoption";

// Real HTTP read graph, disk captures and Work. Only the native boundary and router are recorded.
async function journey() {
  let carriers = "needs-initialization";
  const nativeCalls: { key: string; input: unknown }[] = [];
  const actions: { key: string; input: Record<string, unknown> }[] = [];
  const host = await fixture(false, {
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
    read(input) {
      nativeCalls.push({ key: input.key, input: input.input });
      if (input.key === "revit.catalog.project-index")
        return {
          summary: {
            levelCount: 0,
            sheetCount: 0,
            viewCount: 1,
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
          views: [
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
      if (input.key === "takeoffs.snapshot")
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
  const key = bindWork("takeoffs", path, undefined, ref);
  await fileRouteDocumentStore(join(host.dir, "work")).setState({
    targetKey: workKey(key),
    route: "takeoffs",
    value: {
      version: 1,
      schemaVersion: 1,
      revision: 0,
      doc: takeoffsRouteState.schema.parse({}),
      history: [],
    },
  });
  let generation = 0;
  const pending = new Set<Promise<unknown>>(),
    listeners = new Set<() => void>();
  const source: UseSource = {
    kind: "use",
    open(ctx, deliver) {
      let closed = false, version = 0;
      const refresh = () => {
        const mine = ++version;
        const stamp = ++generation;
        const task = host
          .probe({
            read: "takeoffs.adoption",
            args: { ...(ctx.args as object), target: { kind: "document", ref } },
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
  };
  const first = await host.probe({
    read: "takeoffs.adoption",
    args: { views: [], zones: [], work: "", target: { kind: "document", ref } },
    subscription: "setup",
    generation: 0,
  });
  expect(first.status, await first.clone().text()).toBe(200);
  const stopWork = host.workspace.subscribe(() => listeners.forEach((f) => f()));
  const feed = createWorkFeedClient(
    { subscribe: observeResources(host.workspace, { observe: () => () => {} }), dirty() {} },
    {
      write: (key, write) => host.workspace.write(key, key.route, "human", write),
      submit: () => {
        throw Error("Native commands use the explicit boundary below");
      },
    },
  );
  const work: WorkJournalDoor = {
    ...feed,
    submit(command) {
      actions.push({ key: command.key, input: command.input });
      if (command.key === "takeoffs.initialize") carriers = "ready";
      const result =
        command.key === commands["takeoffs.adopt"].writeBoundary.previewKey
          ? {
              previewOnly: true,
              derivedRequest: {},
              seal: {
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
    module,
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
    workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("takeoffs")}`),
    { work, sources: { "takeoffs.adoption": source } },
  );
  const stop = mount.subscribe(() => {});
  return {
    host,
    mount,
    actions,
    nativeCalls,
    key,
    ready: () =>
      waitFor(
        () => {
          const value = mount.value();
          expect(value.current, value.current ? "" : value.reason).toBe(true);
          expect(mount.workBasis()).toBeTruthy();
        },
        { timeout: 20000 },
      ),
    async close() {
      cleanup();
      stop();
      mount.dispose();
      stopWork();
      await Promise.allSettled([...pending]);
      await host.close();
    },
  };
}
function Drawing({ mount }: { mount: TypedMount }) {
  useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
  return mount.draw("adoption", (ctx) => <AdoptionBody ctx={ctx} />) as React.ReactNode;
}

test("choose adoption views, edit the actual Work, initialize and adopt through typed commands, then inspect a saved capture", async () => {
  const j = await journey();
  try {
    await j.ready();
    render(<Drawing mount={j.mount} />);
    expect(screen.getByRole("button", { name: "Choose views" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose views" }));
    fireEvent.click(await screen.findByRole("option", { name: "Zoning plan" }));
    await j.ready();
    await screen.findByRole("checkbox", { name: "Select Office zone in Zoning plan" });
    expect(j.nativeCalls).toContainEqual({
      key: "takeoffs.snapshot",
      input: { views: ["Zoning plan"], zoneGuids: [] },
    });
    expect(j.nativeCalls).toContainEqual({
      key: "takeoffs.candidates",
      input: { view: "Zoning plan" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Office zone in Zoning plan" }));
    await waitFor(() =>
      expect(j.mount.owner()?.doc.adopt["Zoning plan:21"].edit.value.checked).toBe(true),
    );
    await j.ready();
    const name = screen.getByRole("textbox", { name: "Zone name for Office zone in Zoning plan" });
    fireEvent.change(name, { target: { value: "West office" } });
    fireEvent.blur(name);
    await waitFor(() =>
      expect(j.mount.owner()?.doc.adopt["Zoning plan:21"].edit.value.name).toBe("West office"),
    );
    await j.ready();
    fireEvent.click(screen.getByRole("button", { name: "initialize" }));
    await waitFor(
      () => expect(j.actions.some((row) => row.key === "takeoffs.initialize")).toBe(true),
      { timeout: 20000 },
    );
    await waitFor(
      () =>
        expect(j.mount.value().value.initialize.refusal).toBe(
          "The document already carries every shared parameter",
        ),
      { timeout: 20000 },
    );
    await j.ready();
    expect(j.mount.owner()?.doc.writeIntent["takeoffs.initialize"].edit.value).toEqual({
      stage: "Adoption",
    });
    fireEvent.click(screen.getByRole("button", { name: "adopt" }));
    await waitFor(() => expect(j.actions.map((row) => row.key), j.mount.action("adopt").failure ?? screen.queryByRole("alert")?.textContent ?? "").toContain("takeoffs.adopt"), { timeout: 20000 });
    expect(j.actions.map((row) => row.key)).toContain(
      commands["takeoffs.adopt"].writeBoundary.previewKey,
    );
    const doc = j.mount.owner()!.doc;
    expect(commands["takeoffs.adopt"].workIntent.derive(doc)).toEqual({
      views: [
        { view: "Zoning plan", items: [{ elementId: 21, name: "West office", systemTag: "" }] },
      ],
    });
    await j.ready();
    const data = adoptionData.parse(j.mount.value().value);
    expect(data.captures.length).toBeGreaterThan(0);
    const calls = j.nativeCalls.length;
    j.mount.page.query({ work: data.captures[0]!.id });
    await j.ready();
    expect(j.nativeCalls).toHaveLength(calls);
    expect(screen.getByText(/Archived takeoff/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "live" })).toBeTruthy();
    expect(j.mount.value(loaded).current).toBe(true);
  } finally {
    await j.close();
  }
}, 60000);
