// @vitest-environment jsdom
import * as hostRuntime from "#/host/runtime";
import { peReadings } from "#/readings";
import type { GraphMount, MountAdapters, MountScope } from "#/shell/mount";
import type { ReadingContext, ReadingDelivery } from "#/shell/readings";
import { workKey, type WorkKey } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import { Route as root } from "../routes/__root";
import {
  dataTablesWorkSchema,
  draftFrom,
  pruneReview,
  type DataTablesPage,
  type DataTablesWork,
  type TableHandle,
} from "./graph";
import { dataTablesAdapters, dataTablesRoute } from "./route";
import { dataTablesSources } from "./sources";

const door = vi.hoisted(() => ({ ports: null as object | null }));
const command = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async (original) => ({
  ...(await original<
    typeof import("../../../../packages/mcps/src/shared/takeoff-action-client")
  >()),
  runSemanticAction: (
    ...args: Parameters<
      typeof import("../../../../packages/mcps/src/shared/takeoff-action-client").runSemanticAction
    >
  ) =>
    /\.preview$|^ducts\.preview-/.test(String(args[0]))
      ? Promise.resolve({ state: "succeeded", result: {} } as Awaited<
          ReturnType<
            typeof import("../../../../packages/mcps/src/shared/takeoff-action-client").runSemanticAction
          >
        >)
      : command.run(...args),
}));
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
  scheduleId: 1,
  scheduleUniqueId: "schedule-1",
  columns: [
    { heading: "Load", kind: "Number", parameterName: "Load", sharedParameterGuid: "guid" },
  ],
  rows: [
    { key: "a", elementId: 2, uniqueId: "row-2", values: ["1"] },
    { key: "b", elementId: 3, uniqueId: "row-3", values: ["2"] },
  ],
  placements: [{ sheetId: 4, sheetNumber: "M101", sheetName: "Mechanical" }],
};
const releases: (() => void)[] = [];
beforeEach(() => {
  command.run.mockReset();
  vi.spyOn(hostRuntime, "hostFetch").mockImplementation(
    async () => new Response(JSON.stringify({ tables: [table], issues: [] })),
  );
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
  // Each case owns an independent Work store and therefore a distinct document incarnation.
  const session = crypto.randomUUID();
  const key: WorkKey = {
    binding: "open",
    route: "data-tables",
    target: null,
    open: { session, openId: "document-a" },
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
    target: { kind: "document", ref: { session, openId: "document-a" } },
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
  releases.push(() => owner.dispose());
  return {
    view,
    owner: () => owner,
    scope: () => scope,
    workspace,
    write: ports.write,
    key,
    selectDocument: async (openId: string) => {
      const ref = { session, openId };
      const selected: WorkKey = { binding: "open", route: "data-tables", target: null, open: ref };
      const envelope = await workspace.view(selected, "data-tables");
      scope = {
        target: { kind: "document", ref },
        work: {
          handle: { key: selected, revision: envelope!.revision },
          doc: dataTablesWorkSchema.parse(envelope!.doc),
        },
      };
      for (const notify of listeners) notify();
    },
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
  expect(f.scope().work?.doc.draft?.rows).toEqual(draftFrom(table).rows);
  expect(f.scope().work?.doc.draft?.name).toBe("Edited");
  expect(f.owner().journal(f.scope().work!.handle.key).read().undo).toHaveLength(2);
});

test("switching documents selects that document's Work and returning restores its draft", async () => {
  const f = await mounted();
  fireEvent.click(f.view.getByRole("button", { name: "New table" }));
  const name = await f.view.findByPlaceholderText("Table name");
  fireEvent.change(name, { target: { value: "Document A" } });
  await waitFor(() => expect(f.scope().work?.doc.draft?.name).toBe("Document A"));
  await act(async () => f.selectDocument("document-b"));
  await f.view.findByText("No table open");
  fireEvent.click(f.view.getByRole("button", { name: "New table" }));
  fireEvent.change(await f.view.findByPlaceholderText("Table name"), {
    target: { value: "Document B" },
  });
  await waitFor(() => expect(f.scope().work?.doc.draft?.name).toBe("Document B"));
  await act(async () => f.selectDocument("document-a"));
  await waitFor(() =>
    expect((f.view.getByPlaceholderText("Table name") as HTMLInputElement).value).toBe(
      "Document A",
    ),
  );
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
    .mockResolvedValue(new Response(JSON.stringify({ tables: [table], issues: [] })));
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
