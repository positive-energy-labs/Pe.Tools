// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  familyDraftRouteState,
  familyReads,
  workKey,
  workWriteSchema,
  UNREADABLE_WORK,
} from "@pe/agent-contracts";
import { writeRouteWork } from "#/route/host";
import { Route as root } from "../routes/__root";
import { familyAdapters, familyRoute } from "./route";
import { familyGraph } from "./graph";
import { FamilyHostFixture } from "./host.fixture";

let host: FamilyHostFixture;
const releases: (() => void)[] = [];
beforeEach(() => {
  host = new FamilyHostFixture();
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
  `/family?${new URLSearchParams({ target: host.target.session, stage: "apply", ...search })}`;
async function mounted(url = routeUrl()) {
  const wrap = vi.spyOn(familyAdapters, "wrap");
  const router = createRouter({
    routeTree: root.addChildren([familyRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = familyRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  await view.findByLabelText("Situation");
  await waitFor(() => expect(host.workRequests.length).toBeGreaterThan(0));
  const owner = () => wrap.mock.calls.at(-1)![0];
  if (!host.unreadable && !host.workFailure)
    await waitFor(() => expect(owner().snapshot().work).not.toBeNull());
  await waitFor(() =>
    expect(
      Object.keys(familyGraph.readings).map((id) => owner().readings.get(id).status),
    ).not.toEqual(expect.arrayContaining(["pending"])),
  );
  return { view, router, owner, situation: within(view.getByLabelText("Situation")) };
}
const liveButton = (scope: ReturnType<typeof within>, name: string) =>
  waitFor(() => {
    const button = scope.getByRole("button", { name, exact: true });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    return button;
  });

test("Family URL state round-trips through a real mounted route", async () => {
  const first = await mounted(
    routeUrl({
      query: "Model",
      sort: "-name",
      hidden: "state",
      overlay: "saved",
      drill: "Standard",
      inspector: "param:Model",
      doc: "sheet",
    }),
  );
  expect(first.owner().view.read().page).toMatchObject({
    query: "Model",
    overlay: "saved",
    drill: "Standard",
    inspector: "param:Model",
    doc: "sheet",
  });
  act(() => first.owner().view.setPage({ query: "Changed" }));
  await waitFor(() => expect(first.router.state.location.search.query).toBe("Changed"));
  const url = first.router.state.location.href;
  first.view.unmount();
  const reopened = await mounted(url);
  expect(reopened.owner().view.read().page).toMatchObject({
    query: "Changed",
    overlay: "saved",
    drill: "Standard",
    inspector: "param:Model",
    doc: "sheet",
    hidden: ["state"],
  });
  expect(host.writes).toEqual([]);
});

test("Family bodies mount only the panes and key scopes declared by the graph", async () => {
  const { view } = await mounted();
  const panes = [...view.container.querySelectorAll("[data-pane-id]")]
    .map((node) => node.getAttribute("data-pane-id"))
    .sort((a, b) => a!.localeCompare(b!));
  expect(panes).toEqual(["anatomy", "doc", "spec", "table", "work"]);
});

test("a Family table edit makes one journal step and Mod+Z restores the exact Work", async () => {
  const before = structuredClone(host.doc);
  const proof = await mounted();
  const input = await waitFor(() => {
    return proof.view.getByDisplayValue("Original type");
  });
  fireEvent.change(input, { target: { value: "Edited type" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(host.doc.cells[host.cell]?.edit?.value).toBe("Edited type"));
  expect(host.writes).toHaveLength(1);
  expect(proof.owner().journals.get(workKey(host.key))!.read().undo).toHaveLength(1);
  fireEvent.keyDown(proof.view.getByLabelText("Family route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.writes[1]!.kind).toBe("restore");
  expect(host.doc).toEqual(before);
});

test("Family review seals a plan, commits its ticket and retains the original receipt", async () => {
  const { view, situation, owner } = await mounted();
  fireEvent.click(await liveButton(situation, "Apply family"));
  const review = await situation.findByLabelText("Apply family review");
  expect(review.textContent).toContain(`plan-${host.id}`);
  expect(host.actions.map((row) => row.key)).toEqual(["family.plan"]);
  fireEvent.click(await liveButton(situation, "Apply family"));
  await waitFor(() =>
    expect(owner().results.get("apply")).toMatchObject({
      state: "done",
      kind: "command",
      receipt: { id: host.actions[1]!.id },
    }),
  );
  expect(host.actions[1]!.input).toMatchObject({ plan: `plan-${host.id}`, include: "all" });
  expect(
    (
      await view.findByRole("link", { name: `family.apply · succeeded · ${host.actions[1]!.id}` })
    ).getAttribute("href"),
  ).toContain(host.actions[1]!.id);
});

test("Family receipts exclude another document lifetime even when its action consumed the same Work", async () => {
  await host.fetch("/actions", {
    method: "POST",
    body: JSON.stringify({
      id: "other-family-lifetime",
      key: "family.apply",
      target: { kind: "document", ref: { session: host.target.session, openId: "other-family" } },
      input: { include: "all" },
    }),
  });
  const { view, owner } = await mounted();
  expect(owner().readings.get("receipts").value).toEqual([]);
  expect(view.queryByRole("link", { name: /other-family-lifetime/ })).toBeNull();
});

test("a newer Family Work revision refuses the stale ticket without dispatching apply", async () => {
  const { view, situation } = await mounted();
  fireEvent.click(await liveButton(situation, "Apply family"));
  await situation.findByLabelText("Apply family review");
  await act(async () => {
    await writeRouteWork(
      host.key,
      workWriteSchema.parse({
        expectedRevision: host.revision,
        press: "other-human",
        patches: [{ path: ["cells", host.cell, "edit"], value: { value: "After review" } }],
      }),
    );
  });
  fireEvent.click(await liveButton(situation, "Apply family"));
  await waitFor(() => expect(view.queryByLabelText("Apply family review")).toBeNull());
  expect(
    situation.getAllByRole("status").some((row) => /changed|stale/i.test(row.textContent ?? "")),
  ).toBe(true);
  expect(host.actions.map((row) => row.key)).toEqual(["family.plan"]);
});

test("a Family cell row invokes the kernel take verb and undo restores its exact proposal", async () => {
  host.doc = familyDraftRouteState.schema.parse({
    reading: host.raw,
    cells: { [host.cell]: { suggestion: { value: "Proposed" } } },
  });
  const before = structuredClone(host.doc);
  const { view } = await mounted();
  const row = await view.findByRole("group", { name: `Cell ${host.cell}` });
  fireEvent.click(await liveButton(within(row), "take"));
  await waitFor(() => expect(host.doc.cells[host.cell]?.edit?.value).toBe("Proposed"));
  expect(host.writes).toHaveLength(1);
  fireEvent.keyDown(view.getByLabelText("Family route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.doc).toEqual(before);
});

test("a saved Family query executes at its explicit row without a Work write or undo barrier", async () => {
  const { view, owner } = await mounted(routeUrl({ stage: "history" }));
  fireEvent.change(view.getByLabelText("Saved family reading id"), {
    target: { value: host.saved.id },
  });
  const row = view.getByRole("group", { name: "Saved family reading" });
  fireEvent.click(await liveButton(within(row), "Read saved family"));
  await waitFor(() =>
    expect(
      owner().results.get("saved"),
      JSON.stringify(owner().results.get("saved")),
    ).toMatchObject({
      state: "done",
      kind: "query",
      receipt: { key: "family.saved", input: { id: host.saved.id }, value: host.saved },
    }),
  );
  expect(host.reads).toHaveLength(1);
  expect(host.reads[0]).toMatchObject({
    key: "family.saved",
    scope: host.key,
    target: host.target,
  });
  expect(host.writes).toEqual([]);
  expect(
    owner()
      .timeline.read()
      .some((entry) => entry.kind === "receipt" && entry.paths?.length),
  ).toBe(false);
});

test("kernel gap: Family live read is a query at its row", async () => {
  host.doc.reading = null;
  host.doc.takenAt = null;
  host.doc = familyDraftRouteState.schema.parse({
    ...host.doc,
    cells: { [host.cell]: { edit: { value: "Staged" }, suggestion: { value: "Proposed" } } },
  });
  const cells = structuredClone(host.doc.cells);
  const { view, owner } = await mounted();
  expect(familyReads).toHaveProperty("family.read");
  expect(host.reads).toEqual([]);
  expect(host.writes).toEqual([]);
  fireEvent.click(await liveButton(within(view.container), "Read family"));
  await waitFor(() =>
    expect(owner().results.get("read"), JSON.stringify(owner().results.get("read"))).toMatchObject({
      state: "done",
      kind: "query",
    }),
  );
  expect(host.reads[0]).toMatchObject({ key: "family.read", scope: host.key, target: host.target });
  expect(host.actions).toEqual([]);
  expect(host.writes).toHaveLength(1);
  expect(host.writes[0]).toMatchObject({ kind: "publish", undoable: false });
  expect(host.writes[0]!.patches).toEqual([
    { path: ["reading"], value: host.live.reading },
    { path: ["takenAt"], value: host.live.takenAt },
  ]);
  expect(host.doc).toMatchObject({ reading: host.live.reading, takenAt: host.live.takenAt, cells });
});

test("a refused Family live read preserves the draft and the host's reason", async () => {
  host.readFailure = "The exact family is no longer open";
  const before = structuredClone(host.doc);
  const { view, owner } = await mounted();
  fireEvent.click(await liveButton(within(view.container), "Read family"));
  await waitFor(() =>
    expect(owner().results.get("read")).toMatchObject({
      state: "refused",
      refusal: { message: host.readFailure },
    }),
  );
  expect(host.doc).toEqual(before);
  expect(host.writes).toEqual([]);
});

test("Family Stop cancels the live query by its read id without changing Work", async () => {
  let finish!: (response: Response) => void;
  const held = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  let request: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (body.key === "family.read") {
      request = body;
      return held;
    }
    return host.fetch(input, init);
  });
  const { view, owner } = await mounted();
  fireEvent.click(await liveButton(within(view.container), "Read family"));
  await waitFor(() => expect(request).toBeDefined());
  act(() => owner().stop());
  await waitFor(() =>
    expect(host.reads[0]).toMatchObject({
      key: "family.cancel-read",
      input: { readId: (request!.input as { readId: string }).readId },
      scope: host.key,
      target: host.target,
    }),
  );
  finish(Response.json({ error: "Family read cancelled" }, { status: 409 }));
  await waitFor(() => expect(owner().busy()).toBeNull());
  expect(host.writes).toEqual([]);
});

test("Family saved-query refusals retain the host's exact reason", async () => {
  host.readFailure = "The saved Family reading is not available";
  const { view, owner } = await mounted(routeUrl({ stage: "history" }));
  fireEvent.change(view.getByLabelText("Saved family reading id"), {
    target: { value: host.saved.id },
  });
  fireEvent.click(
    await liveButton(
      within(view.getByRole("group", { name: "Saved family reading" })),
      "Read saved family",
    ),
  );
  await waitFor(() =>
    expect(owner().results.get("saved")).toMatchObject({
      state: "refused",
      refusal: { message: host.readFailure },
    }),
  );
  expect(host.writes).toEqual([]);
});

test("an invalid Family baseline draws its parse failure and refuses a save without crashing", async () => {
  host.doc.reading = "{ invalid Family model";
  const { situation, view } = await mounted(routeUrl({ pod: host.sourceMember.pod }));
  expect(view.getAllByText(/Unexpected|property name|JSON/i).length).toBeGreaterThan(0);
  expect(
    situation.getByRole("button", { name: "Save family to pod" }).getAttribute("aria-disabled"),
  ).toBe("true");
  expect(host.actions).toEqual([]);
});

test("a different selected member never displays the prior member's attached cut sheet while its source loads", async () => {
  let release!: (response: Response) => void;
  const held = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const doc = (name: string) => ({
    jobId: name,
    fileName: `${name}.pdf`,
    pages: [],
    blocks: [{ id: name, page: 1, kind: "text", md: `${name} cut sheet`, bboxes: [] }],
    images: [],
  });
  vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://fixture");
    if (url.pathname === "/pe/family-spec") {
      const path = url.searchParams.get("path")!;
      if (path === "settings/family/other.json.spec.json") return held;
      if (path.endsWith(".spec.json"))
        return Promise.resolve(Response.json({ path: "spec/A.json" }));
      return Promise.resolve(Response.json(doc(path.includes("B.json") ? "B" : "A")));
    }
    return host.fetch(input, init);
  });
  const { view, owner } = await mounted(
    routeUrl({ pod: host.sourceMember.pod, path: host.sourceMember.path }),
  );
  expect(owner().readings.get("spec"), JSON.stringify(owner().readings.get("spec"))).toMatchObject({
    status: "ready",
    value: { member: { path: host.sourceMember.path }, doc: { fileName: "A.pdf" } },
  });
  await view.findByText("A.pdf");
  act(() => {
    owner().view.setPage({ path: "settings/family/other.json" });
  });
  await waitFor(() => expect(view.queryByText("A.pdf")).toBeNull());
  release(Response.json({ path: "spec/B.json" }));
  await view.findByText("B.pdf");
  expect(host.writes).toEqual([]);
});

test("kernel gap: Escape closes the Family inspector through a declared Page verb", async () => {
  const { view, owner } = await mounted(routeUrl({ inspector: "param:Model" }));
  fireEvent.keyDown(view.getByLabelText("Family route"), { key: "Escape" });
  await waitFor(() => expect(owner().view.read().page.inspector).toBe(""));
});

test("kernel gap: saving a Family lands Page on the member returned by the command", async () => {
  const { situation, owner } = await mounted(routeUrl({ pod: host.sourceMember.pod }));
  fireEvent.click(await liveButton(situation, "Save family to pod"));
  await waitFor(() =>
    expect(owner().results.get("capture")).toMatchObject({
      state: "done",
      kind: "command",
      receipt: { result: { member: host.capturedMember } },
    }),
  );
  expect(host.actions[0]!.input).toMatchObject({ pod: host.sourceMember.pod, spec: host.raw });
  await waitFor(() =>
    expect(owner().view.read().page).toMatchObject({
      pod: host.capturedMember.pod,
      path: host.capturedMember.path,
    }),
  );
});

test("Family build reviews and commits the saved member's exact hash", async () => {
  const { situation, owner } = await mounted(
    routeUrl({ pod: host.sourceMember.pod, path: host.sourceMember.path }),
  );
  fireEvent.click(await liveButton(situation, "Build .rfa"));
  const review = await situation.findByLabelText("Build .rfa review");
  expect(review.textContent).toContain(host.sourceMember.sha256);
  expect(host.actions).toEqual([]);
  fireEvent.click(await liveButton(situation, "Build .rfa"));
  await waitFor(() =>
    expect(owner().results.get("build")).toMatchObject({ state: "done", kind: "command" }),
  );
  expect(host.actions[0]).toMatchObject({
    key: "family.build",
    input: { source: host.sourceMember },
  });
});

test("Family build refuses staged edits before preparing or dispatching a saved-file build", async () => {
  host.doc.cells[host.cell] = { edit: { value: "Not on disk" } };
  const { situation } = await mounted(
    routeUrl({ pod: host.sourceMember.pod, path: host.sourceMember.path }),
  );
  const button = situation.getByRole("button", { name: "Build .rfa" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(button);
  expect(host.actions).toEqual([]);
});

test("unreadable Family Work recovers only through the kernel's required review and root barrier", async () => {
  host.unreadable = true;
  const { view, situation, owner } = await mounted();
  expect(await situation.findByText(UNREADABLE_WORK, { exact: false })).toBeTruthy();
  fireEvent.click(await liveButton(situation, "Start fresh"));
  await situation.findByLabelText("Start fresh review");
  expect(host.writes).toEqual([]);
  fireEvent.click(await liveButton(situation, "Start fresh"));
  await waitFor(() => expect(host.writes).toHaveLength(1));
  expect(host.writes[0]).toMatchObject({
    kind: "start-fresh",
    undoable: false,
    aside: "family-aside",
  });
  await waitFor(() => expect(view.queryByText(UNREADABLE_WORK, { exact: false })).toBeNull());
  expect(
    owner()
      .timeline.read()
      .some((entry) => entry.kind === "receipt" && entry.paths?.some((path) => path.length === 0)),
  ).toBe(true);
  expect(host.actions).toEqual([]);
});

test("kernel gap: failed Family Work preserves the host refusal and offers no start fresh", async () => {
  host.workFailure = "fetch failed: host unavailable (503)";
  const { situation } = await mounted();
  expect(situation.queryByRole("button", { name: "Start fresh" })).toBeNull();
  expect(situation.getByText(host.workFailure, { exact: false })).toBeTruthy();
});

test("kernel gap: a Family capture source receives the exact typed WorkKey", async () => {
  const source = familyAdapters.sources["family.profile"]!;
  if (source.kind !== "use" && source.kind !== "feed")
    throw Error("Expected a source subscription");
  const open = vi.spyOn(source, "open");
  await mounted();
  const context = open.mock.calls.find(([context]) => context.workKey !== null)![0];
  expect(context.workKey).toEqual(host.key);
});
