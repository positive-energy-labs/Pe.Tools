// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { workKey } from "@pe/agent-contracts";
import { Route as root } from "../routes/__root";
import { podsRoute, PodsRoute } from "./route";
import { PodsHostFixture } from "./host.fixture";
import { appAtomRegistry } from "../route/route-owner";

let host: PodsHostFixture;
const releases: (() => void)[] = [];
beforeEach(() => {
  host = new PodsHostFixture();
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Each fixture is a different host; retained application atoms must not cross that boundary.
  appAtomRegistry.reset();
  await waitFor(
    () =>
      expect(
        [...host.subscriptions.values()].filter((sub) => sub.request.kind === "work"),
      ).toHaveLength(0),
    { timeout: 3000 },
  );
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mounted({ hosted = false, hidden = false, demo = false } = {}) {
  const url = hosted
    ? "/pods?thread=chat-address&pod=unrelated"
    : demo
      ? "/pods?demo=browse"
      : `/pods?pod=${host.member.pod}&path=${host.member.path}`;
  const router = createRouter({
    routeTree: root.addChildren([podsRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = podsRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      {hosted ? <PodsRoute url={false} thread="conversation-one" hidden={hidden} /> : <Component />}
    </RouterContextProvider>,
  );
  const refused = view.queryByLabelText("Route refused");
  if (refused) throw Error(`Kernel gap: ${refused.textContent}`);
  await view.findByLabelText("Situation");
  await view.findByLabelText("pod members");
  return {
    view,
    router,
    hide: () =>
      view.rerender(
        <RouterContextProvider router={router}>
          <PodsRoute url={false} thread="conversation-one" hidden />
        </RouterContextProvider>,
      ),
  };
}
const button = (view: ReturnType<typeof render>, name: string) =>
  waitFor(() => {
    const button = view.getByRole("button", { name });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    return button;
  });
async function edit(view: ReturnType<typeof render>, value: string) {
  const input = await view.findByLabelText("spec JSON");
  await waitFor(() => expect((input as HTMLTextAreaElement).readOnly).toBe(false));
  fireEvent.change(input, { target: { value } });
  fireEvent.click(await button(view, "Edit member"));
  await waitFor(() => expect(host.doc.fields[""]?.edit?.value).toBe(value));
}

test("member edits use the exact member Work and one kernel undo restores bytes", async () => {
  const before = structuredClone(host.doc);
  const { view } = await mounted();
  await edit(view, '{"width":2}');
  expect(host.writes).toHaveLength(1);
  expect(host.writes[0]!.key).toEqual(host.key);
  fireEvent.keyDown(view.getByLabelText("Pods route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.doc).toEqual(before);
  expect(host.writes[1]!.kind).toBe("restore");
});

test("kernel field review takes a pointer proposal and undo restores its exact provenance", async () => {
  host.doc.fields["/width"] = { suggestion: { value: 5, note: "fixture proposal" } };
  const before = structuredClone(host.doc);
  const { view } = await mounted();
  const row = await view.findByRole("group", { name: "Field /width" });
  fireEvent.click(
    await waitFor(() => {
      const control = within(row).getByRole("button", { name: "take" });
      expect(control.getAttribute("aria-disabled")).not.toBe("true");
      return control;
    }),
  );
  await waitFor(() => expect(host.doc.fields["/width"]?.edit?.value).toBe(5));
  fireEvent.keyDown(view.getByLabelText("Pods route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(host.writes).toHaveLength(2));
  expect(host.doc).toEqual(before);
});

test("a validated draft saves through settings.write and retires the saved Work", async () => {
  const { view } = await mounted();
  await edit(view, '{"width":3}');
  fireEvent.click(await button(view, "save"));
  await waitFor(() => expect(host.actions).toHaveLength(1));
  expect(host.actions[0]!.key).toBe("settings.write");
  expect(host.actions[0]!.input).toMatchObject({ work: { key: host.key, revision: 2 } });
  expect(host.raw).toBe('{"width":3}');
  expect(host.doc.fields).toEqual({});
  await waitFor(() =>
    expect((view.getByLabelText("spec JSON") as HTMLTextAreaElement).value).toBe(host.raw),
  );
});

test("invalid host diagnostics refuse both save destinations", async () => {
  host.invalid = true;
  const { view } = await mounted();
  await edit(view, '{"width":-1}');
  await view.findByText("Width is invalid");
  expect(view.getByRole("button", { name: "save" }).getAttribute("aria-disabled")).toBe("true");
  expect(view.getByRole("button", { name: "save as new" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  expect(host.actions).toEqual([]);
});

test("member selection updates the URL and run scope without writing Work", async () => {
  const { view, router } = await mounted();
  fireEvent.click(await button(view, "Change run scope"));
  await waitFor(() => expect(router.state.location.search.runs).toBe("pod"));
  await waitFor(() =>
    expect(host.calls.filter((call) => call.key === "pod.runs").at(-1)!.request).toEqual({
      pod: host.member.pod,
    }),
  );
  fireEvent.click(await view.findByText("src/tool.cs", { exact: true }));
  await waitFor(() => expect(router.state.location.search.path).toBe("src/tool.cs"));
  await view.findByText("src/tool.cs is source, not a spec");
  expect(host.writes).toEqual([]);
  expect(host.actions).toEqual([]);
});

test("hosted selection stays local to chat and a hidden mount cannot activate a Pod", async () => {
  const { view, router, hide } = await mounted({ hosted: true });
  const address = router.history.location.href;
  fireEvent.click(await view.findByText(host.member.path, { exact: true }));
  await view.findByLabelText("spec JSON");
  expect(router.history.location.href).toBe(address);
  await waitFor(() =>
    expect(
      host.workRequests.some(
        (request) => request.kind === "work" && workKey(request) === workKey(host.key),
      ),
    ).toBe(true),
  );
  const toggle = await view.findByRole("switch", { name: "Fixture pod" });
  fireEvent.click(toggle);
  await waitFor(() => expect(host.activations).toEqual([{ enabled: false }]));
  hide();
  fireEvent.click(await view.findByRole("switch", { name: "Fixture pod" }));
  expect(host.activations).toHaveLength(1);
});

test("a visible member without a basis observes once and publishes its lease facts", async () => {
  host.doc.basis = null;
  const { view, hide } = await mounted({ hosted: true });
  fireEvent.click(await view.findByText(host.member.path, { exact: true }));
  await waitFor(() =>
    expect(host.actions.filter((a) => a.key === "settings.observe")).toHaveLength(1),
  );
  await waitFor(() =>
    expect(
      host.leases.some((lease) => (lease.context as any)?.member?.path === host.member.path),
    ).toBe(true),
  );
  hide();
  await waitFor(() => expect(host.removedLeases).toBeGreaterThan(0));
});

test("fixture browsing keeps raw fragment bytes and makes no host or Work requests", async () => {
  const { view } = await mounted({ demo: true });
  await view.findByText("fixture", { exact: true });
  fireEvent.click(await view.findByText("settings/_fields/Header.json", { exact: true }));
  await view.findByLabelText("spec JSON");
  expect(host.calls).toEqual([]);
  expect(host.workRequests).toEqual([]);
  expect(host.actions).toEqual([]);
});
