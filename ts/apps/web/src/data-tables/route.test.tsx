// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { actionReceiptSchema, workKey, type WorkKey } from "@pe/agent-contracts";
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
const command = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async (original) => ({
  ...(await original<
    typeof import("../../../../packages/mcps/src/shared/takeoff-action-client")
  >()),
  runSemanticAction: command.run,
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
  columns: [{ heading: "Load", kind: "Number" }],
  rows: [
    { key: "a", values: ["1"] },
    { key: "b", values: ["2"] },
  ],
  placements: [{ sheetNumber: "M101" }],
};
const releases: (() => void)[] = [];
beforeEach(() => {
  command.run.mockReset();
  vi.spyOn(hostRuntime, "hostFetch").mockImplementation(
    async () => new Response(JSON.stringify({ tables: [table] })),
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
  const key: WorkKey = {
    binding: "open",
    route: "data-tables",
    target: null,
    open: { session: "fixture", openId: "document-a" },
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
    target: { kind: "document", ref: { session: "fixture", openId: "document-a" } },
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
    workspace,
    write: ports.write,
    key,
    selectDocument: async (openId: string) => {
      const ref = { session: "fixture", openId };
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
  expect(f.scope().work?.doc.draft?.rows).toEqual(table.rows);
  expect(f.scope().work?.doc.draft?.name).toBe("Edited");
  expect(f.owner().journal(f.scope().work!.handle.key).read().undo).toHaveLength(2);
});

test("Apply requires a prune review, refuses changed Work, and submits the sealed reviewed draft", async () => {
  const f = await mounted();
  fireEvent.click(f.view.getByRole("button", { name: "New table" }));
  await waitFor(() => expect(f.scope().work?.doc.draft?.isNew).toBe(true));
  fireEvent.change(f.view.getByPlaceholderText("Table name"), { target: { value: "Loads" } });
  await waitFor(() => expect(f.scope().work?.doc.draft?.name).toBe("Loads"));
  fireEvent.click(f.view.getByRole("button", { name: "Apply" }));
  const review = await f.view.findByLabelText("Apply review");
  expect(review.textContent).toContain("Prune deletes 2 rows");
  expect(review.textContent).toContain("Delete row a");
  expect(review.textContent).toContain("Delete row b");
  expect(review.textContent).not.toContain('"table"');
  expect(command.run).not.toHaveBeenCalled();
  await act(async () => {
    await f.write(f.key, {
      patches: [{ path: ["draft", "name"], value: "Changed" }],
      expectedRevision: f.scope().work!.handle.revision,
      press: "other-human",
      kind: "apply",
    });
  });
  fireEvent.click(f.view.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(f.view.queryByLabelText("Apply review")).toBeNull());
  expect(command.run).not.toHaveBeenCalled();
  fireEvent.click(f.view.getByRole("button", { name: "Apply" }));
  await f.view.findByLabelText("Apply review");
  command.run.mockResolvedValue(
    actionReceiptSchema.parse({
      id: "applied",
      key: "data-table.apply",
      caller: { kind: "human", via: "local" },
      basis: { kind: "human" },
      target: f.scope().target,
      input: {},
      state: "succeeded",
      result: { name: "Changed" },
      consumes: [],
      effects: [],
      steps: [],
      prepared: { state: "ready", value: null },
      recovery: [],
      startedAt: "2026-10-30T06:00:00Z",
    }),
  );
  fireEvent.change(f.view.getByLabelText("Apply answers"), { target: { value: "{}" } });
  fireEvent.click(f.view.getByRole("button", { name: "Apply" }));
  await waitFor(() =>
    expect(
      f.owner().results.get("apply"),
      JSON.stringify(f.owner().results.get("apply")),
    ).toMatchObject({ state: "done" }),
  );
  expect(command.run).toHaveBeenCalledOnce();
  expect(command.run).toHaveBeenCalledWith(
    "data-table.apply",
    {
      table: {
        name: "Changed",
        columns: f.scope().work!.doc.draft!.columns,
        rows: f.scope().work!.doc.draft!.rows,
        pruneMissingRows: true,
      },
    },
    f.scope().target,
    f.scope().work!.handle,
    "",
    expect.any(String),
    expect.any(Number),
  );
  await waitFor(() => expect(f.owner().view.read().page.table).toBe("Changed"));
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
