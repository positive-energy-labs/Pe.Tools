// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { scheduleGridRouteState, workWriteSchema } from "@pe/agent-contracts";
import { writeRouteWork } from "#/route/host";
import { Route as root } from "../routes/__root";
import { schedulesRoute } from "./route";
import { SchedulesHostFixture } from "./host.fixture";

let host: SchedulesHostFixture;
const releases: (() => void)[] = [];
beforeEach(() => {
  host = new SchedulesHostFixture();
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
});
afterEach(async () => {
  cleanup();
  for (const release of releases.splice(0)) release();
  await new Promise((resolve) => setTimeout(resolve, 450));
  vi.unstubAllGlobals();
});

function routeUrl(search: Record<string, string> = {}, withWork = true) {
  return `/schedules?${new URLSearchParams({
    target: host.target.session,
    ...(withWork ? { work: host.workspaceId } : {}),
    workspaceId: host.workspaceId,
    stage: "apply",
    ...search,
  })}`;
}
async function mounted(url = routeUrl()) {
  const router = createRouter({
    routeTree: root.addChildren([schedulesRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = schedulesRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  await view.findByLabelText("Situation");
  await waitFor(() => expect(host.workRequests.length).toBeGreaterThan(0));
  return { view, router, situation: within(view.getByLabelText("Situation")) };
}
const liveButton = async (scope: ReturnType<typeof within>, name: string) =>
  waitFor(() => {
    const button = scope.getByRole("button", { name, exact: true });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    return button;
  });

test("a URL restores the grid view and an edit round-trips into a reopened URL", async () => {
  const first = await mounted(
    routeUrl({ query: "Model~Old", sort: "-c1", hidden: "c0", cell: "1::1" }),
  );
  expect((first.situation.getByLabelText("query") as HTMLInputElement).value).toBe("Model~Old");
  expect(first.router.state.location.search).toMatchObject({
    sort: "-c1",
    hidden: "c0",
    cell: "1::1",
  });
  fireEvent.change(first.situation.getByLabelText("query"), { target: { value: "Model~New" } });
  await waitFor(() => expect(first.router.state.location.search.query).toBe("Model~New"));
  const url = first.router.state.location.href;
  first.view.unmount();
  const reopened = await mounted(url);
  expect((reopened.situation.getByLabelText("query") as HTMLInputElement).value).toBe("Model~New");
  expect(host.writes).toEqual([]);
});

test("a Work verb produces one journal step and Mod+Z restores the cells", async () => {
  const before = structuredClone(host.doc);
  const { view } = await mounted();
  const input = await waitFor(() => {
    const input = view.container.querySelector<HTMLInputElement>("tbody input.dl-cell-input");
    expect(input).not.toBeNull();
    return input!;
  });
  input.focus();
  fireEvent.change(input, { target: { value: "Edited model" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(host.doc.cells["1::1"]?.edit?.value).toBe("Edited model"));
  expect(host.writes).toHaveLength(1);
  expect(host.writes[0]).toMatchObject({ kind: "apply", by: "human", base: 1, revision: 2 });
  fireEvent.keyDown(view.getByLabelText("Schedules route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.writes[1]).toMatchObject({ kind: "restore", base: 2, revision: 3, press: null });
  expect(host.doc).toEqual(before);
});

test("Apply cells shows a ticket then commits once and consumes its receipt", async () => {
  const { view, situation } = await mounted();
  fireEvent.click(await liveButton(situation, "Apply cells"));
  const review = await situation.findByLabelText("Apply cells review");
  expect(review.textContent).toContain(host.capture);
  expect(review.textContent).toContain("New model");
  expect(host.actions).toEqual([]);
  fireEvent.click(await liveButton(situation, "Apply cells"));
  await waitFor(() => expect(host.actions).toHaveLength(1));
  expect(host.actions[0]).toMatchObject({ key: "schedule.grid.push", state: "succeeded" });
  await waitFor(() => expect(view.queryByLabelText("Apply cells review")).toBeNull());
  const receipt = await view.findByRole("link", { name: "Open push receipt" });
  expect(receipt.getAttribute("href")).toContain(host.actions[0]!.id);
});

test("a Work write makes the ticket stale and cannot dispatch a push", async () => {
  const { view, situation } = await mounted();
  fireEvent.click(await liveButton(situation, "Apply cells"));
  await situation.findByLabelText("Apply cells review");
  await act(async () => {
    await writeRouteWork(
      host.key,
      workWriteSchema.parse({
        expectedRevision: host.revision,
        press: "another-human",
        patches: [{ path: ["cells", "1::1", "edit"], value: { value: "Changed after review" } }],
      }),
    );
  });
  await waitFor(() => expect(host.revision).toBe(2));
  fireEvent.click(await liveButton(situation, "Apply cells"));
  await waitFor(() => expect(view.queryByLabelText("Apply cells review")).toBeNull());
  expect(
    situation.getAllByRole("status").some((row) => /changed|stale/i.test(row.textContent ?? "")),
  ).toBe(true);
  expect(host.actions).toEqual([]);
});

test("push refusals and unread readback counts are kernel readings, never Page or Work", async () => {
  host.pushResult = {
    applied: 0,
    failures: [{ key: "1::1", error: "native binding moved" }],
    readbackError: "Readback unavailable",
  };
  const before = structuredClone(host.doc);
  const { view, situation, router } = await mounted();
  fireEvent.click(await liveButton(situation, "Apply cells"));
  await situation.findByLabelText("Apply cells review");
  fireEvent.click(await liveButton(situation, "Apply cells"));
  await view.findByText("Readback unavailable");
  expect(view.getByText(/1 refused as changed in Revit/)).toBeTruthy();
  expect(view.container.textContent).toContain("native binding moved");
  expect(host.doc).toEqual(before);
  expect(router.state.location.search).not.toHaveProperty("refused");
  expect(router.state.location.search).not.toHaveProperty("unread");
});

test("taking a cell row uses the kernel cell verb and one undo restores its proposal", async () => {
  host.doc = scheduleGridRouteState.schema.parse({
    basis: host.doc.basis,
    cells: { "1::1": { suggestion: { value: "Proposed model" } } },
  });
  const before = structuredClone(host.doc);
  const { view } = await mounted();
  const row = await view.findByRole("group", { name: "Cell 1::1" });
  fireEvent.click(await liveButton(within(row), "take"));
  await waitFor(() => expect(host.doc.cells["1::1"]?.edit?.value).toBe("Proposed model"));
  expect(host.writes).toHaveLength(1);
  fireEvent.keyDown(view.getByLabelText("Schedules route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.doc).toEqual(before);
});

test("kernel gap: a schedule workspaceId URL must select that subject's Work", async () => {
  await mounted(routeUrl({}, false));
  expect(
    host.workRequests.some(
      (request) =>
        request.kind === "work" &&
        request.binding === "workspace" &&
        request.work === host.workspaceId,
    ),
  ).toBe(true);
});

test("kernel gap: the graph's native Read query must execute at its declared row", async () => {
  const { view } = await mounted();
  const read = await view.findByRole("button", { name: "Read schedule" });
  expect(
    read.getAttribute("aria-disabled"),
    "The kernel must bind schedule.grid.snapshot queries",
  ).not.toBe("true");
  fireEvent.click(read);
  await waitFor(() =>
    expect(host.reads).toEqual([{ key: "schedule.grid.snapshot", input: { scheduleId: 42 } }]),
  );
});
