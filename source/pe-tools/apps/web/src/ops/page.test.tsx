// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { expect, test, vi } from "vite-plus/test";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActionJournal } from "../../../host/src/action-journal";
import { RevitBridge } from "../../../host/src/bridge";
import { makeCallRoute } from "../../../host/src/call-route";
import { opsCatalogRoute } from "../../../host/src/ops-catalog";
import { hostResourceObserver } from "../../../host/src/resource-adapters";
import { resourceEventSource } from "../../../host/tests/resource-fixture";
import { createOpsStore } from "./store";
import { OpsPage } from "./route-workspace";
vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));

test("mounted host-only Ops runs raw input and observes same-ID completion over the actual receipt stream", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ops-page-"));
  const owner = new ActionJournal(join(dir, "journal.json"));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let effects = 0;
  const bridge = {
    list: Effect.succeed([]),
    snapshot: () => Effect.succeed({ connected: false }),
    invoke: () => Effect.die("native forbidden"),
  } as unknown as RevitBridge["Service"];
  const web = HttpRouter.toWebHandler(
    Layer.mergeAll(
      makeCallRoute(owner, undefined, {
        launchShell: async () => {
          effects++;
          await held;
        },
      }),
      opsCatalogRoute(() => Effect.die("not navigation")),
    ).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
    { disableLogger: true },
  );
  const socket = resourceEventSource(hostResourceObserver(undefined, () => owner));
  const posts: string[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://ops-page");
    if (init?.method === "POST") posts.push(url.pathname);
    return web.handler(new Request(url, init), Context.empty() as never);
  });
  const registry = AtomRegistry.make();
  const store = createOpsStore({
    registry,
    hostBaseUrl: "http://ops-page",
    initial: {
      op: "host.shell.open",
      request: { args: JSON.stringify({ path: dir }), mode: "raw", formValues: {} },
    },
  });
  // The shell reads `?target=` through the router, so the page mounts inside a memory router.
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <RegistryContext.Provider value={registry}>
          <OpsPage store={store} />
        </RegistryContext.Provider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const mounted = render(<RouterProvider router={router} />);
  try {
    const input = await screen.findByRole("textbox", { name: "Operation request JSON" });
    expect((input as HTMLTextAreaElement).value).toBe(JSON.stringify({ path: dir }));
    const run = screen.getByRole("button", { name: "Run" });
    await vi.waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(run);
    await vi.waitFor(() => expect(effects).toBe(1));
    const id = registry.get(store.atoms.actionId)!;
    await screen.findByText(`Action ${id} / running`);
    release();
    await screen.findByText(`Action ${id} / reply received`);
    expect(screen.getByLabelText("Returned operation payload").textContent).toContain(
      '"opened": true',
    );
    expect(posts.filter((path) => path === "/actions")).toHaveLength(1);
    expect(posts.some((path) => path.includes("route-state"))).toBe(false);
    expect(
      socket.requests.some((url) => decodeURIComponent(url).includes('"kind":"receipts"')),
    ).toBe(true);
    mounted.unmount();
  } finally {
    release();
    cleanup();
    store.dispose();
    registry.dispose();
    socket.close();
    vi.unstubAllGlobals();
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
