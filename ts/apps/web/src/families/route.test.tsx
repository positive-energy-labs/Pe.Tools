// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { familiesRouteState, workKey, workWriteSchema } from "@pe/agent-contracts";
import { UNREADABLE_WORK } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { writeRouteWork } from "#/route/host";
import { Route as root } from "../routes/__root";
import { familiesAdapters, familiesRoute } from "./route";
import { familiesGraph } from "./graph";
import { FamiliesHostFixture } from "./host.fixture";

let host: FamiliesHostFixture;
const releases: (() => void)[] = [];
beforeEach(() => {
  host = new FamiliesHostFixture();
  vi.stubGlobal("EventSource", host.source());
  vi.stubGlobal("fetch", host.fetch);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
});
afterEach(async () => {
  cleanup();
  for (const release of releases.splice(0)) release();
  await new Promise((resolve) => setTimeout(resolve, 450));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const routeUrl = (search: Record<string, string> = {}) =>
  `/families?${new URLSearchParams({ target: host.target.session, stage: "apply", ...search })}`;
async function mounted(url = routeUrl()) {
  const wrap = vi.spyOn(familiesAdapters, "wrap");
  const router = createRouter({
    routeTree: root.addChildren([familiesRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = familiesRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  await view.findByLabelText("Situation");
  await waitFor(() => expect(host.workRequests.length).toBeGreaterThan(0));
  await waitFor(() =>
    expect(
      Object.keys(familiesGraph.readings).map(
        (id) => wrap.mock.calls.at(-1)![0].readings.get(id).status,
      ),
    ).not.toEqual(expect.arrayContaining(["pending"])),
  );
  return {
    view,
    router,
    situation: within(view.getByLabelText("Situation")),
    owner: () => wrap.mock.calls.at(-1)![0],
  };
}
const liveButton = (scope: ReturnType<typeof within>, name: string) =>
  waitFor(() => {
    const button = scope.getByRole("button", { name, exact: true });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    return button;
  });
const modelInput = (view: Awaited<ReturnType<typeof mounted>>["view"]) =>
  waitFor(() => {
    const cell = view.queryByLabelText("PE_G___Model · Fan Coil Unit - Ducted · FCU-1");
    expect(
      cell,
      JSON.stringify(
        [...view.container.querySelectorAll('[role="gridcell"]')].map((item) =>
          item.getAttribute("aria-label"),
        ),
      ),
    ).not.toBeNull();
    const input = cell!.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();
    return input!;
  });

test("a URL restores the family table and a query edit round-trips through a reopened URL", async () => {
  const first = await mounted(
    routeUrl({ query: "Model", sort: "-name", hidden: "kind", past: "old-read" }),
  );
  expect(first.owner().view.read().page.query).toBe("Model");
  expect(first.router.state.location.search).toMatchObject({
    sort: "-name",
    hidden: "kind",
    past: "old-read",
  });
  act(() => first.owner().view.setPage({ query: "Manufacturer" }));
  await waitFor(() => expect(first.router.state.location.search.query).toBe("Manufacturer"));
  const url = first.router.state.location.href;
  first.view.unmount();
  const reopened = await mounted(url);
  expect(reopened.owner().view.read().page.query).toBe("Manufacturer");
  expect(host.writes).toEqual([]);
});

test("a family table cell edit is one journal step per press and Mod+Z restores exactly", async () => {
  const before = structuredClone(host.doc);
  const proof = await mounted();
  const input = await modelInput(proof.view);
  input.focus();
  fireEvent.change(input, { target: { value: "First press" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(host.doc.cells[host.cell]?.edit?.value.value).toBe("First press"));
  const first = structuredClone(host.doc);
  expect(host.writes).toHaveLength(1);
  expect(proof.owner().journals.get(workKey(host.key))!.read().undo).toHaveLength(1);
  await waitFor(() => expect(proof.owner().busy()).toBeNull());
  await waitFor(() => expect(proof.owner().snapshot().work?.handle.revision).toBe(host.revision));
  const secondInput = await modelInput(proof.view);
  fireEvent.change(secondInput, { target: { value: "Second press" } });
  fireEvent.keyDown(secondInput, { key: "Enter" });
  await waitFor(() => expect(host.doc.cells[host.cell]?.edit?.value.value).toBe("Second press"));
  expect(host.writes).toHaveLength(2);
  expect(proof.owner().journals.get(workKey(host.key))!.read().undo).toHaveLength(2);
  fireEvent.keyDown(proof.view.getByLabelText("Families route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(3));
  expect(host.doc).toEqual(first);
  fireEvent.keyDown(proof.view.getByLabelText("Families route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(4));
  expect(host.doc).toEqual(before);
  expect(host.writes[2]?.kind).toBe("restore");
  expect(host.writes[3]?.kind).toBe("restore");
});

test("kernel gap: prepared Families plan evidence reaches the real route's commit and receipt", async () => {
  const { view, situation, owner } = await mounted();
  fireEvent.click(await liveButton(situation, "Apply families"));
  await waitFor(() => expect(owner().results.get("apply")).toMatchObject({ state: "review" }));
  const review = await situation.findByLabelText("Apply families review");
  expect(review.textContent).toContain(`plan-${host.id}`);
  expect(host.actions.map((row) => row.key)).toEqual(["families.plan"]);
  fireEvent.click(await liveButton(situation, "Apply families"));
  await waitFor(() => expect(owner().results.get("apply")).toMatchObject({ state: "done" }));
  expect(host.actions[1]!.input).toMatchObject({ plan: `plan-${host.id}`, include: "all" });
  await waitFor(() => expect(view.queryByLabelText("Apply families review")).toBeNull());
  const receipt = await view.findByRole("link", { name: "Open family receipt" });
  expect(receipt.getAttribute("href")).toContain(host.actions[1]!.id);
  expect(owner().results.get("apply")).toMatchObject({
    state: "done",
    kind: "command",
    receipt: { id: host.actions[1]!.id },
  });
});

test("a Work write makes the Families review ticket stale and refuses native apply", async () => {
  const { view, situation } = await mounted();
  fireEvent.click(await liveButton(situation, "Apply families"));
  await situation.findByLabelText("Apply families review");
  await act(async () => {
    await writeRouteWork(
      host.key,
      workWriteSchema.parse({
        expectedRevision: host.revision,
        press: "other-human",
        patches: [
          {
            path: ["cells", host.cell, "edit"],
            value: { value: { value: "Changed after review", storageType: "String" } },
          },
        ],
      }),
    );
  });
  fireEvent.click(await liveButton(situation, "Apply families"));
  await waitFor(() => expect(view.queryByLabelText("Apply families review")).toBeNull());
  expect(
    situation.getAllByRole("status").some((row) => /changed|stale/i.test(row.textContent ?? "")),
  ).toBe(true);
  expect(host.actions.map((row) => row.key)).toEqual(["families.plan"]);
});

test("a family cell row takes the kernel verb and one undo restores the exact proposal", async () => {
  host.doc = familiesRouteState.schema.parse({
    scope: host.doc.scope,
    takenAt: host.doc.takenAt,
    cells: {
      [host.cell]: { suggestion: { value: { value: "Proposed model", storageType: "String" } } },
    },
  });
  const before = structuredClone(host.doc);
  const { view } = await mounted();
  const row = await view.findByRole("group", { name: `Cell ${host.cell}` });
  fireEvent.click(await liveButton(within(row), "take"));
  await waitFor(() => expect(host.doc.cells[host.cell]?.edit?.value.value).toBe("Proposed model"));
  expect(host.writes).toHaveLength(1);
  fireEvent.keyDown(view.getByLabelText("Families route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.doc).toEqual(before);
});

test("kernel gap: native catalog requests retain the exact document headers through the kernel source", async () => {
  await mounted();
  await waitFor(() => expect(host.catalogHeaders.length).toBeGreaterThan(0));
  for (const headers of host.catalogHeaders) {
    expect(headers.get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBe(host.target.session);
    expect(headers.get(HOST_RPC_DOCUMENT_HEADER)).toBe(host.target.openId);
  }
});

test("kernel gap: Families salvage uses the kernel recovery review and one undoable Work write", async () => {
  host.doc = familiesRouteState.schema.parse({ takenAt: host.doc.takenAt });
  host.salvage = { familyNames: ["Fan Coil Unit - Ducted"], familyIds: [], scope: host.filter };
  const before = structuredClone(host.doc);
  const { view, situation, owner } = await mounted();
  fireEvent.click(await liveButton(situation, "Carry over"));
  await situation.findByLabelText("Carry over review");
  expect(host.writes).toEqual([]);
  fireEvent.click(await liveButton(situation, "Carry over"));
  await waitFor(() => expect(owner().results.get("work.salvage")).toMatchObject({ state: "done" }));
  expect(host.doc.excluded["Fan Coil Unit - Ducted"]).toEqual({ by: "human" });
  expect(host.doc.scope.edit?.value).toEqual(host.filter);
  expect(owner().journals.get(workKey(host.key))!.read().undo).toHaveLength(1);
  expect(
    owner()
      .timeline.read()
      .some((row) => row.kind === "receipt" && row.paths?.some((path) => path.length === 0)),
  ).toBe(false);
  fireEvent.keyDown(view.getByLabelText("Families route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.doc).toEqual(before);
});

test("kernel gap: Families ID-only salvage resolves exact-document catalog names before kernel recovery", async () => {
  host.doc = familiesRouteState.schema.parse({ takenAt: host.doc.takenAt });
  host.salvage = { familyNames: [], familyIds: [3101] };
  const { situation } = await mounted();
  await waitFor(() => expect(host.catalogHeaders.length).toBeGreaterThan(0));
  fireEvent.click(await liveButton(situation, "Carry over"));
  await situation.findByLabelText("Carry over review");
  expect(host.writes).toEqual([]);
  fireEvent.click(await liveButton(situation, "Carry over"));
  await waitFor(() => expect(host.doc.excluded["Fan Coil Unit - Ducted"]).toEqual({ by: "human" }));
  expect(host.writes).toHaveLength(1);
});

test("kernel gap: unreadable Families Work shows the host refusal and recovers only through the kernel review", async () => {
  host.unreadable = true;
  const { view, situation } = await mounted();
  expect(await situation.findByText(UNREADABLE_WORK, { exact: false })).toBeTruthy();
  expect(
    situation.getByRole("button", { name: "Apply families" }).getAttribute("aria-disabled"),
  ).toBe("true");
  fireEvent.click(await liveButton(situation, "Start fresh"));
  await situation.findByLabelText("Start fresh review");
  expect(host.writes).toEqual([]);
  fireEvent.click(await liveButton(situation, "Start fresh"));
  await waitFor(() => expect(host.writes).toHaveLength(1));
  expect(host.writes[0]).toMatchObject({ kind: "start-fresh", undoable: false, aside: "aside-1" });
  await waitFor(() => expect(view.queryByText(UNREADABLE_WORK, { exact: false })).toBeNull());
  expect(host.actions).toEqual([]);
});

test("a scope proposal is a kernel root-cell row before any matrix read exists", async () => {
  host.doc = familiesRouteState.schema.parse({ scope: { suggestion: { value: host.filter } } });
  const before = structuredClone(host.doc);
  const { view } = await mounted();
  const row = await view.findByRole("group", { name: "Cell scope" });
  fireEvent.click(await liveButton(within(row), "take"));
  await waitFor(() => expect(host.doc.scope.edit?.value).toEqual(host.filter));
  expect(host.reads).toEqual([]);
  expect(host.writes).toHaveLength(1);
  fireEvent.keyDown(view.getByLabelText("Families route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.doc).toEqual(before);
});

test("native Families read uses the kernel query and records one scope edit", async () => {
  const { view, owner } = await mounted();
  fireEvent.click(await liveButton(within(view.container), "Read families"));
  await waitFor(() =>
    expect(owner().results.get("read")).toMatchObject({ state: "done", kind: "query" }),
  );
  expect(host.reads).toHaveLength(1);
  expect(host.writes).toHaveLength(1);
  expect(host.reads[0]).toMatchObject({ work: host.key, filter: host.filter, expectedRevision: 1 });
});

test("holding a named family back is one Work verb and undo restores its inclusion", async () => {
  const before = structuredClone(host.doc);
  const { view } = await mounted();
  const row = await view.findByRole("group", {
    name: "Family Fan Coil Unit - Ducted",
  });
  fireEvent.click(await liveButton(within(row), "Hold family back"));
  await waitFor(() => expect(host.doc.excluded["Fan Coil Unit - Ducted"]).toEqual({ by: "human" }));
  expect(host.writes).toHaveLength(1);
  fireEvent.keyDown(view.getByLabelText("Families route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.doc).toEqual(before);
});

test("History opens the newest immutable read without native catalog, capture or edit controls", async () => {
  const { view } = await mounted(routeUrl({ stage: "history" }));
  await view.findByLabelText("PE_G___Model · Fan Coil Unit - Ducted · FCU-1");
  expect(view.container.querySelectorAll('[role="gridcell"] input')).toHaveLength(0);
  expect(view.queryByRole("button", { name: "Read families" })).toBeNull();
  expect(host.catalogHeaders).toEqual([]);
  expect(host.reads).toEqual([]);
  expect(host.writes).toEqual([]);
  expect(host.actions).toEqual([]);
});
