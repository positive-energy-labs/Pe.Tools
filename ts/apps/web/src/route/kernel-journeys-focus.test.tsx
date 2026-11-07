// @vitest-environment jsdom
import { useState } from "react";
import { createPortal } from "react-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { route } from "./typed-route";
import { module as fans } from "../fans/route";
import { TypedShell } from "../shell/typed-shell";
import * as mounts from "../shell/typed-mount";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { ReviewSurface } from "../shell/review-surface";
import { RouteVisibility } from "./activity";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("JZ B04 read a long review, dismiss with Escape and return to its opener", async () => {
  function Journey() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Review airflows</button>{open && <ReviewSurface
      label="Update airflows" sentence="Change Supply" rows={Array.from({ length: 200 }, (_, i) => `Change ${i}`)}
      enabled confirm={() => { throw Error("Escape must not commit"); }} cancel={() => setOpen(false)} />}</>;
  }
  const view = render(<Journey />);
  const opener = screen.getByRole("button", { name: "Review airflows" });
  opener.focus();
  fireEvent.click(opener);
  const commit = await screen.findByRole("button", { name: "Commit Update airflows" });
  expect(view.container.contains(commit), "B04: review is portalled").toBe(false);
  expect(screen.getByText("Change 199"), "B04: final change is present").toBeTruthy();
  commit.focus();
  expect(document.activeElement).toBe(commit);
  fireEvent.keyDown(commit, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Commit Update airflows" })).toBeNull());
  await waitFor(() => expect(document.activeElement, "B04: dismissal restores prior focus").toBe(opener));
  // Scroll reach and footer visibility require Driver layout evidence; jsdom cannot establish either.
});

test("JZ B02 undo follows focus between typed routes, portal and hidden pane; text keeps native undo", async () => {
  const live = mounts.mountTypedRoute;
  const owners: mounts.TypedMount[] = [];
  vi.spyOn(mounts, "mountTypedRoute").mockImplementation((...args) => {
    const owner = live(...args); owners.push(owner); return owner;
  });
  const make = (key: string) => route({ ...fans.spec, key, name: key, needs: "browser", core: undefined,
    subject: undefined, reads: {}, edits: undefined, commands: {}, fields: {},
    panes: { main: { title: key, purpose: "Focus ownership", draw: () => <><button>{key} focus</button><textarea aria-label={`${key} text`} />{createPortal(<button>{key} portal</button>, document.body)}</> } },
    layout: { kind: "pane", id: "main" } });
  const a = make("jz-a"), b = make("jz-b");
  const stamp = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  const address = () => ({ read: () => new URLSearchParams(), write: () => {}, subscribe: () => () => {} });
  const addressA = address(), addressB = address();
  function Journey() {
    const [hidden, setHidden] = useState(false);
    return <><button onClick={() => setHidden(true)}>Hide B</button><TypedShell module={a} fingerprint={stamp} address={addressA} />
      <RouteVisibility.Provider value={!hidden}><div hidden={hidden}><TypedShell module={b} fingerprint={stamp} address={addressB} /></div></RouteVisibility.Provider></>;
  }
  const root = createRootRoute({ component: Journey });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "jz-b focus" });
  expect(owners).toHaveLength(2);
  const undo = owners.map(owner => vi.spyOn(owner.history, "undo"));
  const press = (node: HTMLElement) => { node.focus(); const native = fireEvent.keyDown(node, { key: "z", code: "KeyZ", ctrlKey: true }); fireEvent.keyUp(node, { key: "z", code: "KeyZ", ctrlKey: true }); return native; };
  press(screen.getByRole("textbox", { name: "jz-a text" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: browser retains text undo").toEqual([0, 0]);
  press(screen.getByRole("button", { name: "jz-a focus" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: only the focused route receives undo").toEqual([1, 0]);
  press(screen.getByRole("button", { name: "jz-b portal" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: portal belongs to B").toEqual([1, 1]);
  fireEvent.click(screen.getByRole("button", { name: "Hide B" }));
  press(screen.getByRole("button", { name: "jz-a focus" }));
  expect(undo.map(spy => spy.mock.calls.length), "B02: hidden B cannot steal undo").toEqual([2, 1]);
});


// Only the conversation/reading boundaries are recorded. RouteDock, Activity, typed Family,
// Work feeds, file persistence and the Host view HTTP handler remain production owners.
const conversation = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../workbench/provider", () => ({ useWorkbench: () => conversation.value }));
vi.mock("../chat/chat-shell", () => ({ ChatShell: () => null }));

test("JZ B05 retain Family Work and its spec across folding, first-thread promotion and thread switches", async () => {
  const [{ createRoute }, { RegistryContext }, { appAtomRegistry }, { RouteDock },
    { createChatPageStore }, { module: family }, { publicRoutes }, { peClient },
    { createPeClient }, { peReadings }, { observeResources }, { createPeRoutes },
    { fileRouteDocumentStore }, { fixture, who }, { withInvocationContext },
    { bindWork, workKey, familyDraftSchema }, { rememberPlace },
    { readThreadWork }, { chatPluginTitle }] = await Promise.all([
      import("@tanstack/react-router"), import("@effect/atom-react"), import("../shell/owner"),
      import("../workbench/route-panes"), import("../workbench/store"), import("../family/route"),
      import("./route-discovery"), import("../host/pe-client"), import("@pe/agent-contracts/pe-api"),
      import("../host/resource-stream"), import("@pe/runtime"), import("../../../host/src/pe-routes"),
      import("../../../host/src/route-document-store"), import("../../../host/tests/host-read-graph.test-support"),
      import("@pe/runtime/context"), import("@pe/agent-contracts"),
      import("../../../host/src/thread-work-context"), import("../../../host/src/navigation"),
      import("../workbench/chat-plugins"),
    ]);
  const { join } = await import("node:path");
  // Import the shipped root, not builtin-routes: the root must actually bootstrap discovery.
  await import("../routes/__root");
  const host = await fixture();
  await host.send(0, []);
  const api = createPeRoutes({ workspace: host.workspace, registrations: [] });
  const key = bindWork("family", null);
  const member = { pod: "family-context-journey", path: "settings/family/silencer.json" };
  const doc = familyDraftSchema.parse({ reading: "captured-family", spec: { member, doc: {
    jobId: "retained-spec", fileName: "retained-spec.pdf", images: [],
    pages: [{ page: 1, width: 612, height: 792, screenshotUrl: null, markdown: "Retained specification" }],
    blocks: [{ id: "page-1-block-1", page: 1, kind: "text", md: "Retained specification", bboxes: [] }],
  } } });
  await fileRouteDocumentStore(join(host.dir, "work")).setState({ targetKey: workKey(key), route: "family",
    value: { version: 1, schemaVersion: 1, revision: 3, doc, history: [] } });
  const transport = createPeClient("", (input, init) => withInvocationContext({ caller: who }, () =>
    api.fetch(new Request(new URL(String(input), "http://host"), init))));
  vi.spyOn(peClient, "call").mockImplementation(transport.call);
  vi.spyOn(peReadings, "subscribe").mockImplementation(observeResources(host.workspace, { observe: () => () => {} }));
  // No native or provider turn is needed to address existing Work. Keep Value unavailable.
  vi.spyOn(await import("../shell/host-read-source"), "hostReadSource")
    .mockReturnValue({ kind: "use", open: () => () => {} });
  vi.spyOn(await import("../navigation/surface-host"), "useSurfaceHost").mockReturnValue({ surface: "web" } as never);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const threads = [{ id: "jz-family-first" }, { id: "jz-family-other" }];
  const store = createChatPageStore({ registry: appAtomRegistry, search: { mode: "threads", patch: async () => {} } });
  conversation.value = { store, threads };
  const { builtinRouteStamp } = await import("./builtin-inventory");
  const stamp = workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("family")}`);
  const declaration = route({ ...family.spec, panes: { workspace: {
    ...family.spec.panes.workspace,
    draw: ctx => <output aria-label="Mounted Family Work">{ctx.cells.doc?.spec?.doc.fileName}</output>,
  } } });
  function Family() { return <TypedShell module={declaration} fingerprint={stamp} />; }
  const root = createRootRoute({ component: () => <RegistryContext.Provider value={appAtomRegistry}>
    <RouteDock renderRoute={body => body}>{null}</RouteDock>
  </RegistryContext.Provider> });
  const router = createRouter({ routeTree: root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/family", component: Family }),
  ]), history: createMemoryHistory({ initialEntries: ["/family"] }) });
  const read = (thread: string) => withInvocationContext({ caller: { kind: "pea", context: `ctx-${thread}`, thread } },
    () => api.fetch(new Request(`http://host/pe/route-view/family?thread=${thread}`)));
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    await router.load();
    render(<RouterProvider router={router} />);
    await screen.findByText("retained-spec.pdf");
    const seam = screen.getByRole("separator", { name: "Resize pane" });
    for (let i = 0; i < 40 && !screen.queryByRole("button", { name: "Expand tools" }); i++)
      fireEvent.keyDown(seam, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "Expand tools" }), "B05: the actual tools Activity is folded").toBeTruthy();
    await (await import("@testing-library/react")).act(() => store.actions.promoteThread(threads[0]!.id));
    expect(router.state.location.search.thread, "B05: first Send supplies the thread after the drawing folded").toBe(threads[0]!.id);
    await waitFor(async () => expect((await read(threads[0]!.id)).status,
      "B05: folding before promotion must not lose the selected Place").toBe(200));
    const first = await (await read(threads[0]!.id)).json();
    expect(first.context.work, "B05: mounted Work is host-bound, not the conversation document").toEqual(key);
    expect(first.work, "B05: Pea receives authoritative Work including its attached spec").toMatchObject({ revision: 3, doc });
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 20_000);
    await (await import("@testing-library/react")).act(() => vi.advanceTimersByTimeAsync(5_000));
    expect((await read(threads[0]!.id)).status, "B05: a folded Place refreshes past the 15-second lease expiry").toBe(200);
    await (await import("@testing-library/react")).act(() => router.navigate({ to: "/family", search: { thread: threads[1]!.id } }));
    await waitFor(async () => expect((await read(threads[1]!.id)).status).toBe(200));
    expect((await read(threads[0]!.id)).status, "B05: switching conversation retires the previous association").toBe(409);
    await (await import("@testing-library/react")).act(() => router.navigate({ to: "/family", search: { thread: threads[0]!.id } }));
    await waitFor(async () => expect((await read(threads[0]!.id)).status).toBe(200));
    expect((await (await read(threads[0]!.id)).json()).work).toMatchObject({ revision: 3, doc });
    expect(publicRoutes.declaration("family"), "B05: the shipped root registers typed builtins").toMatchObject({ name: "Family" });
    const context = rememberPlace({ documents: [], works: [] }, "family", "/family");
    const snapshot = await readThreadWork(host.workspace, {
      threads: async () => [], documents: async () => [], contexts: () => [{ threadId: threads[0]!.id, context }],
    });
    expect(chatPluginTitle(snapshot.threads[0]!.place!), "B05: the row names its Place independently of unfinished Work").toBe("Family");
  } finally {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
    await host.close();
    vi.unstubAllGlobals();
    conversation.value = null;
  }
}, 30_000);
