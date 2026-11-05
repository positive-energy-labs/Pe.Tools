// @vitest-environment jsdom
import * as hostRuntime from "#/host/runtime";
import { peReadings } from "#/readings";
import type { GraphMount } from "#/shell/mount";
import * as workScope from "#/shell/use-work-scope";
import * as workHost from "#/route/host";
import { appAtomRegistry } from "#/shell/owner";
import { readingKey, workKey, type WorkKey, type WorkWrite } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import { Route as root } from "../routes/__root";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import {
  dataTablesWorkSchema,
  draftFrom,
  pruneReview,
  type DataTablesPage,
  type DataTablesWork,
  type TableHandle,
} from "./graph";
import { dataTablesAdapters, dataTablesRoute } from "./route";

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
  appAtomRegistry.reset();
  for (const release of releases.splice(0).reverse()) release();
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
  let openIds = ["document-a", "document-b"];
  const documents = () => openIds.map((openId) => ({
    openId, title: openId, address: null, isFamilyDocument: false, isActive: false,
  }));
  const inventory = () => ({
    sessions: [{ sessionId: session, connected: true,
      openDocumentCount: openIds.length, openDocuments: documents() }],
  });
  const censusSubscribers = new Set<() => void>();
  const observe = observeResources(workspace, { observe: () => () => {} }, (request, publish) => {
    const key = readingKey(request);
    if (request.kind === "inventory" || request.kind === "machine") {
      const emit = () => publish({ kind: "snapshot", key, value: request.kind === "inventory"
        ? inventory() : machineFixture([{ session, documents: documents() }]) });
      censusSubscribers.add(emit);
      emit();
      return () => { censusSubscribers.delete(emit); };
    }
    if (request.kind !== "receipts") throw Error(`Unexpected external Reading: ${request.kind}`);
    publish({ kind: "snapshot", key, value: [] });
    return () => {};
  });
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, publish) => {
    const release = observe(request, publish);
    releases.push(release);
    return release;
  });
  const write = vi.spyOn(workHost, "writeRouteWork").mockImplementation(
    (requested, write) => workspace.write(requested, "data-tables", "human", write),
  );
  // Call-through observation only: the route receives the real hook's exact ports and status.
  const scopes = vi.spyOn(workScope, "useWorkScope");
  const ports = () => {
    const result = scopes.mock.results.at(-1)!;
    if (result.type !== "return") throw Error("Work scope did not return");
    return result.value as workScope.WorkScopePorts<DataTablesWork>;
  };
  let nativeTables = [table];
  const fetch = vi.spyOn(hostRuntime, "hostFetch").mockImplementation(
    async (path, init) => {
      if (path !== "/call" || JSON.parse(String(init?.body)).key !== "revit.detail.data-tables")
        throw Error(`Unexpected native request: ${path}`);
      return new Response(JSON.stringify({ tables: nativeTables, issues: [] }));
    },
  );
  let owner!: GraphMount<DataTablesPage, DataTablesWork>;
  const previousWrap = dataTablesAdapters.wrap;
  releases.push(() => { dataTablesAdapters.wrap = previousWrap; });
  dataTablesAdapters.wrap = (current, children) => {
    owner = current;
    return children;
  };
  const router = createRouter({
    routeTree: root.addChildren([dataTablesRoute]),
    history: createMemoryHistory({ initialEntries: [
      `/data-tables?target=${encodeURIComponent(JSON.stringify({ kind: "open", ref: key.open }))}`,
    ] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await view.findByRole("button", { name: "Open table" });
  await waitFor(() => expect(ports().getSnapshot().work?.handle.key).toEqual(key));
  releases.push(() => owner.dispose());
  return {
    view,
    owner: () => owner,
    scope: () => ports().getSnapshot(),
    ports,
    write,
    fetch,
    key,
    persisted: () => structuredClone([...stored]),
    selectDocument: async (openId: string) => {
      router.history.push(`/data-tables?target=${encodeURIComponent(
        JSON.stringify({ kind: "open", ref: { session, openId } }),
      )}`);
      await waitFor(() => expect(ports().getSnapshot().work?.handle.key).toEqual({
        ...key, open: { session, openId },
      }));
    },
    closeDocument: (openId: string) => {
      openIds = openIds.filter((id) => id !== openId);
      for (const emit of censusSubscribers) emit();
    },
    refresh: (tables: TableHandle[]) => {
      nativeTables = tables;
      owner.readings.refresh(["tables"]);
    },
  };
}

test("the real graph mount copies native values into Work once and a refresh preserves edits", async () => {
  const f = await mounted();
  fireEvent.click(f.view.getByRole("button", { name: "Open table" }));
  await waitFor(() => expect(f.scope().work?.doc.draft).toMatchObject({
    name: "Loads", isNew: false,
    rows: [{ key: "a", values: ["1"] }, { key: "b", values: ["2"] }],
    columns: [{ heading: "Load", kind: "Number" }],
  }));
  expect(f.view.getByText(/M101/)).toBeTruthy();
  expect(f.fetch).toHaveBeenCalledWith("/call", expect.objectContaining({
    method: "POST", body: JSON.stringify({ key: "revit.detail.data-tables", request: {} }),
    headers: expect.objectContaining({
      [HOST_RPC_BRIDGE_SESSION_HEADER]: f.key.open!.session,
      [HOST_RPC_DOCUMENT_HEADER]: "document-a",
    }),
  }));
  const name = await f.view.findByPlaceholderText("Table name");
  fireEvent.change(name, { target: { value: "Edited" } });
  await waitFor(() => expect(f.scope().work?.doc.draft?.name).toBe("Edited"));
  await act(async () => f.refresh([{ ...table, rows: [] }]));
  await waitFor(() => expect(f.owner().readings.get("tables").value).toEqual([{ ...table, rows: [] }]));
  expect(f.scope().work?.doc.draft?.rows).toEqual([
    { key: "a", values: ["1"] }, { key: "b", values: ["2"] },
  ]);
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

test("real selected Work refuses foreign identity, stale revision and a closed document without changing disk", async () => {
  const f = await mounted();
  const a = f.scope().work!.handle;
  await act(async () => f.selectDocument("document-b"));
  const b = f.scope().work!.handle;
  expect(a.revision).toBe(b.revision);
  expect(workKey(a.key)).not.toBe(workKey(b.key));
  expect(f.ports().status.resolution).toEqual({ kind: "resolved", target: {
    kind: "document", ref: { session: f.key.open!.session, openId: "document-b" },
  } });
  const attempted: WorkWrite = { kind: "apply", expectedRevision: b.revision, press: "foreign",
    patches: [{ path: ["draft"], value: { ...draftFrom(table), name: "Unsafe replacement" } }],
  };
  const beforeForeign = f.persisted();
  expect(await f.ports().write(a.key, attempted)).toMatchObject({ ok: false, kind: "refused" });
  expect(f.write).not.toHaveBeenCalled();
  expect(f.persisted()).toEqual(beforeForeign);

  // Advance B through the actual editor, then reuse B's earlier numeric revision at the host.
  fireEvent.click(f.view.getByRole("button", { name: "New table" }));
  await waitFor(() => expect(f.scope().work?.doc.draft?.isNew).toBe(true));
  expect(f.scope().work!.handle.revision).toBe(b.revision + 1);
  expect(f.write).toHaveBeenCalledOnce();
  const beforeStale = f.persisted();
  await act(async () => {
    expect(await f.ports().write(b.key, { ...attempted, press: "stale" })).toMatchObject({
      ok: false, code: "stale_revision",
    });
  });
  expect(f.write).toHaveBeenCalledTimes(2);
  expect(f.persisted()).toEqual(beforeStale);

  const current = f.scope().work!.handle;
  await act(async () => f.closeDocument("document-b"));
  await waitFor(() => expect(f.ports().status.closed).toBe(true));
  expect(f.ports().status.resolution).toMatchObject({ kind: "choose", reason: "document-closed" });
  expect(f.scope().work!.handle).toEqual(current);
  expect(f.scope().work!.doc.draft?.isNew).toBe(true);
  const beforeClosed = f.persisted();
  expect(await f.ports().write(current.key, { ...attempted, expectedRevision: current.revision,
    press: "closed" })).toMatchObject({ ok: false, kind: "refused" });
  expect(f.write).toHaveBeenCalledTimes(2);
  expect(f.persisted()).toEqual(beforeClosed);
});
