// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { workKey, type WorkKey } from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import { peReadings } from "#/readings";
import { Route as root } from "../routes/__root";
import type { GraphMount, MountScope, MountAdapters } from "#/shell/mount";
import type { ReadingDelivery } from "#/shell/readings";
import type { ReadingContext } from "#/shell/readings";
import * as hostRuntime from "#/host/runtime";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { dataTablesAdapters, dataTablesRoute } from "./route";
import {
  dataTablesWorkSchema,
  draftFrom,
  pruneReview,
  type DataTablesPage,
  type DataTablesWork,
  type TableHandle,
} from "./graph";
import { dataTablesSources } from "./sources";

const door = vi.hoisted(() => ({ ports: null as object | null }));
vi.mock("../shell/use-work-scope", () => ({
  useWorkScope: () => ({
    ...door.ports,
    status: {
      resolution: { kind: "resolved", target: { kind: "host" } },
      bindingLost: null,
      targetProvenance: { source: "none" },
      closed: false,
    },
  }),
}));
vi.mock("../routes/__root", async () => {
  const { createRootRoute, Outlet } = await import("@tanstack/react-router");
  return { Route: createRootRoute({ component: Outlet }) };
});

const table: TableHandle = {
  name: "Loads",
  columns: [{ heading: "Load", kind: "Number" }],
  rows: [
    { key: "a", values: ["1"] },
    { key: "b", values: ["2"] },
  ],
  placements: [{ sheetNumber: "M101" }],
};
const releases: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(peReadings, "subscribe").mockImplementation(() => () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  for (const release of releases.splice(0)) release();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mounted() {
  const key: WorkKey = {
    binding: "workspace",
    route: "data-tables",
    target: null,
    work: "fixture",
  };
  const stored = new Map<string, unknown>();
  const workspace = new RouteWorkspace({
    registrations: [
      {
        spec: {
          route: "data-tables",
          title: "Data Tables",
          description: "Fixture",
          schema: dataTablesWorkSchema,
        },
      },
    ],
    store: {
      getState: async ({ targetKey }) => structuredClone(stored.get(targetKey) ?? null),
      setState: async ({ targetKey, value }) => {
        stored.set(targetKey, structuredClone(value));
      },
    },
  });
  let scope: MountScope<DataTablesWork> = {
    target: { kind: "host" },
    work: { handle: { key, revision: 0 }, doc: dataTablesWorkSchema.parse({}) },
  };
  const listeners = new Set<() => void>();
  const ports: Pick<
    MountAdapters<DataTablesPage, DataTablesWork>,
    "getSnapshot" | "subscribe" | "write" | "subscribeAcceptedDeltas"
  > = {
    getSnapshot: () => scope,
    subscribe: (notify) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    write: async (requested, write) => {
      const result = await workspace.write(requested, requested.route, "human", write);
      if (result.ok) {
        const envelope = await workspace.read(requested, requested.route);
        scope = {
          ...scope,
          work: {
            handle: { key: requested, revision: envelope!.revision },
            doc: envelope!.doc as DataTablesWork,
          },
        };
        for (const notify of listeners) notify();
      }
      return result;
    },
    subscribeAcceptedDeltas: (requested, accept) =>
      workspace.subscribe((event) => {
        if (event.ok && workKey(event.key) === workKey(requested)) accept(event);
      }),
  };
  door.ports = ports;
  let deliver!: ReadingDelivery;
  const source = dataTablesAdapters.sources["data-tables.tables"]!;
  vi.spyOn(source as { open: (...args: any[]) => unknown }, "open").mockImplementation(
    (_context, publish) => {
      deliver = publish;
      publish({ kind: "complete", value: structuredClone([table]), revision: 1 });
    },
  );
  let owner!: GraphMount<DataTablesPage, DataTablesWork>;
  dataTablesAdapters.wrap = (current, children) => {
    owner = current;
    return children;
  };
  const router = createRouter({
    routeTree: root.addChildren([dataTablesRoute]),
    history: createMemoryHistory({ initialEntries: ["/data-tables"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await view.findByRole("button", { name: "Open table" });
  return {
    view,
    owner: () => owner,
    scope: () => scope,
    deliver: (value: TableHandle[]) => deliver({ kind: "complete", value, revision: 2 }),
  };
}

test("the real graph mount copies native values into Work once and a refresh preserves edits", async () => {
  const f = await mounted();
  fireEvent.click(f.view.getByRole("button", { name: "Open table" }));
  await waitFor(() => expect(f.scope().work?.doc.draft).toEqual(draftFrom(table)));
  expect(f.view.getByText(/M101/)).toBeTruthy();
  const name = await f.view.findByPlaceholderText("Table name");
  fireEvent.change(name, { target: { value: "Edited" } });
  await waitFor(() => expect(f.scope().work?.doc.draft?.name).toBe("Edited"));
  await act(async () => f.deliver([{ ...table, rows: [] }]));
  expect(f.scope().work?.doc.draft?.rows).toEqual(table.rows);
  expect(f.scope().work?.doc.draft?.name).toBe("Edited");
  expect(f.owner().journal(f.scope().work!.handle.key).read().undo).toHaveLength(2);
});

test("new table creates editable Text columns and keyed rows as kernel Work", async () => {
  const f = await mounted();
  fireEvent.click(f.view.getByRole("button", { name: "New table" }));
  await waitFor(() => expect(f.scope().work?.doc.draft?.isNew).toBe(true));
  fireEvent.click(await f.view.findByRole("button", { name: "add row" }));
  await waitFor(() => expect(f.scope().work?.doc.draft?.rows).toHaveLength(2));
  const draft = f.scope().work!.doc.draft!;
  expect(new Set(draft.rows.map((row) => row.key)).size).toBe(2);
  expect(draft.columns).toEqual([{ heading: "Column 1", kind: "Text" }]);
});

test("review counts native destination rows missing by key, including rename collisions", () => {
  const draft = { ...draftFrom(table), rows: [table.rows[0]!] };
  expect(pruneReview(draft, [table])).toMatchObject({
    deletedRows: 1,
    deletedKeys: ["b"],
    summary: "Apply Loads. Prune deletes 1 rows from this table in Revit.",
    table: { pruneMissingRows: true },
  });
  expect(pruneReview({ ...draft, name: "New name" }, [table]).deletedRows).toBe(0);
  expect(
    pruneReview({ ...draft, name: "Existing" }, [{ ...table, name: "Existing" }]).deletedRows,
  ).toBe(1);
  expect(pruneReview({ ...draft, isNew: true }, [table]).deletedRows).toBe(1);
});

test("the native source carries the selected document headers and preserves placements", async () => {
  const fetch = vi
    .spyOn(hostRuntime, "hostFetch")
    .mockResolvedValue(new Response(JSON.stringify({ tables: [table] })));
  const target = {
    kind: "document" as const,
    ref: { session: "chosen-session", openId: "chosen-document" },
  };
  const source = dataTablesSources()["data-tables.tables"];
  const publications: unknown[] = [];
  await source.open(
    {
      target,
      workKey: null,
      workRevision: null,
      page: { table: "" },
      work: null,
      attempt: { target, workKey: null, generation: 1 },
      trigger: { kind: "demand" },
      args: null,
      inputs: {},
      signal: new AbortController().signal,
    } satisfies ReadingContext,
    (publication) => {
      publications.push(publication);
    },
  );
  expect(fetch).toHaveBeenCalledWith(
    "/call",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ key: "revit.detail.data-tables", request: {} }),
      headers: expect.objectContaining({
        [HOST_RPC_BRIDGE_SESSION_HEADER]: "chosen-session",
        [HOST_RPC_DOCUMENT_HEADER]: "chosen-document",
      }),
    }),
  );
  expect(publications).toEqual([{ kind: "complete", value: [table], revision: 1 }]);
});
