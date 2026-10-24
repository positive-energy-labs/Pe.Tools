// @vitest-environment jsdom
import { createContext, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { routeAddress, type ThreadTab } from "@pe/agent-contracts";
import { appAtomRegistry } from "#/route/route-owner";
import { createChatPageStore } from "./store";
import { RouteDock } from "./route-panes";

const store = createChatPageStore({
  registry: appAtomRegistry,
  search: { mode: "threads", patch: async () => {} },
});
const ducts: ThreadTab = {
  id: "tab-ducts",
  route: "ducts",
  link: routeAddress("ducts").link({ system: "S1" } as never),
  at: "2026-10-24T00:00:00.000Z",
};
const TAB = `${routeAddress("ducts").title} · S1`;
const threads = [{ id: "T", tabs: [ducts] }];
vi.mock("./provider", () => ({ useWorkbench: () => ({ store, threads }) }));
vi.mock("#/chat/chat-shell", () => ({ ChatShell: () => <div data-chat-probe="">pea</div> }));
vi.mock("#/route/situation-ladder", () => ({ ChatPlanIntent: createContext(null) }));
vi.mock("#/readings", () => ({
  useReading: () => ({ state: "pending" }),
  previousOf: () => undefined,
}));
vi.mock("#/navigation/surface-host", () => ({ useSurfaceHost: () => ({ surface: "web" }) }));
vi.mock("#/host/pe-client", () => ({
  peClient: { call: vi.fn(async () => ({ tabs: [ducts] })) },
}));

let mounts = 0;
function DuctsProbe() {
  useState(() => ++mounts);
  const system = useRouterState({
    select: (state) => (state.location.search as { system?: string }).system,
  });
  return <output data-ducts-probe="">{system}</output>;
}

beforeEach(() => {
  mounts = 0;
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mount() {
  const root = createRootRoute({
    component: () => <RouteDock renderRoute={(body) => body}>{null}</RouteDock>,
  });
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/pea" }),
    createRoute({ getParentRoute: () => root, path: "/ducts", component: DuctsProbe }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/pea?thread=T"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: TAB });
  return router;
}
const tools = () => document.querySelector<HTMLElement>('[data-pane-id="tools"]')!;

test("a thread opens its conversation with Pea first and the tools collapsed, no tool opened", async () => {
  const router = await mount();
  await act(() => new Promise((done) => setTimeout(done, 50)));
  expect(router.state.location.pathname).toBe("/pea");
  expect(screen.getByRole("button", { name: TAB }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByText("tools collapsed")).toBeTruthy();
  const pea = document.querySelector("[data-chat-probe]")!;
  expect(pea.compareDocumentPosition(tools()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(mounts).toBe(0);
});

test("a tab press expands the tools on that Place; a Work press restores its Page without a remount", async () => {
  const router = await mount();
  fireEvent.click(screen.getByRole("button", { name: TAB }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/ducts"));
  await waitFor(() => expect(screen.getByText("S1")).toBeTruthy());
  expect(screen.queryByText("tools collapsed")).toBeNull();
  expect(mounts).toBe(1);

  await act(() => router.navigate({ to: "/pea", search: { thread: "T" } } as never));
  expect(screen.getByText("tools collapsed")).toBeTruthy();
  await act(() => store.actions.openWork("T", "ducts"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/ducts"));
  expect((router.state.location.search as { system?: string }).system).toBe("S1");
  // A Work press is outside the tools bar: focus lands on the tool's pane.
  expect(document.activeElement).toBe(tools());
  expect(document.querySelector("[data-chat-probe]")).toBeTruthy();
  expect(mounts).toBe(1);
});
