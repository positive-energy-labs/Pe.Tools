// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { WorkOwner } from "@pe/kit/lang/work";
import { NavigationProvider, useNavigation } from "./state";
import { useLedgerList } from "./ledger";
import { LEDGER_PRESENTATIONS } from "./ledger-model";

const ports = vi.hoisted(() => ({ read: vi.fn(), call: vi.fn() }));
vi.mock("./navigation-client", () => ({ navigationClient: () => ({ read: ports.read }) }));
vi.mock("#/host/pe-client", () => ({ peClient: { call: ports.call } }));
vi.mock("#/machine/use-machine", () => ({ useMachine: () => ({ reading: { state: "absent" } }) }));
vi.mock("#/route/pod-routes", () => ({ usePodRoutes: () => null }));
vi.mock("./surface-host", () => ({ useSurfaceHost: () => ({ surface: "web" }) }));
vi.mock("#/workbench/provider/harness-client", () => ({
  harnessClient: () => ({
    summaries: (accept: (value: unknown[]) => void) => {
      accept([]);
      return () => {};
    },
  }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("blur-only focus refresh keeps navigation, ledger readiness, mounted context and the surface sweep idle", async () => {
  const snapshot = {
    observedAt: "2026-11-01T00:00:00Z",
    works: [],
    threads: [],
    observations: [],
    truncated: false,
  };
  let answerNavigation!: (value: typeof snapshot) => void;
  let answerReceipts!: (value: unknown[]) => void;
  ports.read
    .mockReset()
    .mockResolvedValueOnce(snapshot)
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          answerNavigation = resolve;
        }),
    );
  ports.call
    .mockReset()
    .mockResolvedValueOnce([])
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          answerReceipts = resolve;
        }),
    );
  const mounted = vi.fn();
  const unmounted = vi.fn();
  let seen: ReturnType<typeof useNavigation> | undefined;
  function Body() {
    seen = useNavigation();
    const ledger = useLedgerList(LEDGER_PRESENTATIONS.home);
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return (
      <p data-testid="context" data-ledger-status={ledger.props.status}>
        Retained context
      </p>
    );
  }
  const root = createRootRoute({
    component: () => (
      <WorkOwner owner="surface">
        <NavigationProvider>
          <Body />
        </NavigationProvider>
      </WorkOwner>
    ),
  });
  const route = createRoute({ getParentRoute: () => root, path: "/ducts" });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/ducts"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(seen?.loading).toBe(false));
  const context = view.getByTestId("context");
  const visibility = vi.fn();
  document.addEventListener("visibilitychange", visibility);
  try {
    fireEvent.blur(window);
    fireEvent.focus(window);
    await waitFor(() => expect(ports.read).toHaveBeenCalledTimes(2));
    expect(ports.call).toHaveBeenCalledTimes(2);
    expect(ports.call).toHaveBeenLastCalledWith("actions.read", {});
    expect(seen?.loading).toBe(false); // Revalidation retains ready content, including its status.
    expect(seen?.snapshot).toBe(snapshot);
    expect(view.getByTestId("context")).toBe(context);
    expect(context.getAttribute("data-ledger-status")).toBe("ready");
    expect(view.container.querySelector("[data-working]")).toBeNull();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    expect(visibility).not.toHaveBeenCalled();
    await act(async () => {
      answerNavigation(snapshot);
      answerReceipts([]);
    });
    expect(seen?.loading).toBe(false);
    expect(view.container.querySelector("[data-working]")).toBeNull();
  } finally {
    document.removeEventListener("visibilitychange", visibility);
  }
});
