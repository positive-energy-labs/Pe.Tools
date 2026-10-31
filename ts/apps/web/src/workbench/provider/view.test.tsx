// @vitest-environment jsdom
/** First Send from a standalone tool: one chat, seeded only by the composer, the tool kept. */
import { useContext } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { RegistryContext } from "@effect/atom-react";
import { appAtomRegistry } from "#/shell/owner";
import { WorkbenchContext } from "./thread-summary";
import { WorkbenchProvider } from "./view";
import { useRouteTabs } from "../tabs";

const client = vi.hoisted(() => ({
  create: vi.fn(async (_provider: string) => ({ id: "NEW", head: { revision: 0 }, modelId: "m" })),
  target: vi.fn(async () => ({ ok: true })),
  prompt: vi.fn(async () => ({})),
  threads: vi.fn(async () => [] as unknown[]),
  summaries: () => () => {},
  model: vi.fn(),
  trait: vi.fn(),
}));
const call = vi.hoisted(() => vi.fn(async (..._: unknown[]) => ({})));
vi.mock("./harness-client", () => ({ harnessClient: () => client, notFound: () => false }));
vi.mock("./thread-stream", () => ({
  useThreadStream: () => ({ chat: {}, bodyAtom: null, pending: false, error: undefined }),
  chatLoading: () => false,
}));
vi.mock("@pe/agent-contracts/chat-state", async (actual) => ({
  ...(await actual<object>()),
  selectRunStatus: () => "idle",
  selectTurnFailure: () => undefined,
}));
vi.mock("./providers", () => ({
  EMPTY_HEAD: { traits: {} },
  isReady: () => true,
  useProviders: () => ({ list: [{ id: "p", name: "P", readiness: { state: "ready" } }] }),
}));
// No composer document: the machine has none to offer.
vi.mock("#/machine/use-machine", () => ({ useMachineSlice: () => null }));
vi.mock("#/readings", () => ({
  previousOf: () => undefined,
  useHostStatusSlice: (select: (status: unknown) => unknown) => select({ state: "pending" }),
  useHostEvents: () => {},
}));
vi.mock("#/navigation/surface-host", () => ({ useSurfaceHost: () => ({ surface: "web" }) }));
vi.mock("#/host/pe-client", () => ({ peClient: { call } }));

afterEach(cleanup);

let send: ((text: string) => Promise<void>) | null = null;
let openThread: ((id: string) => void) | null = null;
function Probe() {
  useRouteTabs();
  const context = useContext(WorkbenchContext)!;
  send = (text) => context.sendPrompt({ text } as never);
  openThread = context.openThread;
  return null;
}

test("first Send from /ducts?target=… creates one chat with no targets and keeps the tool", async () => {
  sessionStorage.clear();
  const root = createRootRoute({
    component: () => (
      <WorkbenchProvider>
        <Probe />
        {/* Stands in for the composer: it lives outside the routed body. */}
        <input aria-label="draft" />
        <Outlet />
      </WorkbenchProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/" }),
      createRoute({ getParentRoute: () => root, path: "/ducts", component: () => <p>ducts</p> }),
    ]),
    history: createMemoryHistory({
      initialEntries: ["/", "/ducts?target=C%3A%2FModels%2FOffice.rvt"],
    }),
  });
  await router.load();
  // The roster lists the new chat once the host made it.
  client.threads.mockImplementation(async () => [
    {
      id: "NEW",
      head: { revision: 0, targets: [] },
      lifecycle: { revision: 0, readSeq: 0 },
      activity: { lastSeq: 0 },
      lastSeq: 0,
      updatedAt: "2026-10-25T00:00:00.000Z",
    },
  ]);
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <RouterProvider router={router} />
    </RegistryContext.Provider>,
  );
  await screen.findByText("ducts");
  fireEvent.change(screen.getByLabelText("draft"), { target: { value: "unsent words" } });
  await act(() => send!("size it"));

  expect(client.create).toHaveBeenCalledTimes(1);
  // initialTargets = []: the tool's pin never seeds the chat's targets.
  expect(client.target).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe("/ducts");
  expect(router.state.location.search).toMatchObject({
    target: "C:/Models/Office.rvt",
    thread: "NEW",
  });
  expect(client.prompt).toHaveBeenCalledWith("NEW", expect.objectContaining({ text: "size it" }));
  expect(call.mock.calls.filter(([door]) => door === "thread.place")).toEqual([
    [
      "thread.place",
      { params: { id: "NEW" }, body: { route: "ducts", link: expect.stringContaining("/ducts") } },
    ],
  ]);

  // Promotion replaced the tool entry: Back is Home, Forward is the promoted tool; the draft stays.
  await act(async () => router.history.back());
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  await act(async () => router.history.forward());
  await waitFor(() => expect(router.state.location.pathname).toBe("/ducts"));
  expect(router.state.location.search).toMatchObject({ thread: "NEW" });
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("unsent words");
  expect(client.create).toHaveBeenCalledTimes(1);
  await act(async () => {
    openThread!("OTHER");
  });
  await waitFor(() => expect(router.state.location.search.thread).toBe("OTHER"));
  expect(router.state.location.pathname).toBe("/ducts");
  expect(router.state.location.search.target).toBe("C:/Models/Office.rvt");
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("unsent words");
});
