// @vitest-environment jsdom
/**
 * Driver defect (homes gate 7e350aba): after a discard on /pods no feed row was visible on the
 * page. The cause was that no route page drew the notice feed. Every route's top bar now counts the
 * rows that ask for a person, and the count opens the existing overlay.
 * Mutant, run red once (2026-11-12): `openNotices` returns null for every feed.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { NoticeFeed } from "@pe/agent-contracts";
import { AppBar } from "./app-bar";
import { RouteControlsProvider, usePalette } from "./route-controls";
import { SurfaceHostProvider } from "./surface-host";

const row = (key: string, group: NoticeFeed["rows"][number]["group"], verb: string) => ({
  key,
  group,
  revision: 0,
  verb,
  what: "Work for pods",
  where: "this computer",
  says: "Could not be read, so it was discarded",
  at: "2026-11-12T03:15:00.000Z",
  url: null,
  refusal: "Nothing to open: the file is gone",
});
const state = vi.hoisted(() => ({ feed: { id: 1, tray: false, rows: [] as unknown[] } }));

vi.mock("#/host/resource-state", async (actual) => ({
  ...(await actual<typeof import("#/host/resource-state")>()),
  useReading: (request: { kind: string } | null) =>
    request?.kind === "notices" ? { state: "ready", observation: state.feed } : { state: "absent" },
}));
vi.mock("#/workbench/provider/harness-client", () => ({
  harnessClient: () => ({ summaries: () => () => {} }),
}));
vi.mock("#/workbench/config", () => ({ resolveWorkbenchConfig: () => ({ origin: "" }) }));
vi.mock("#/host/pe-client", () => ({ peClient: { call: vi.fn(async () => []) } }));
vi.mock("#/machine/use-machine", () => ({ useMachine: () => ({ reading: { state: "absent" } }) }));
vi.mock("#/navigation/state", () => ({
  useNavigation: () => ({ snapshot: null, loading: false, error: undefined, refresh() {} }),
  useDestination: () => () => true,
}));
// The overlay itself is the ledger's and has its own tests; here only its open state matters.
vi.mock("./global-search", () => ({ GlobalSearch: () => null }));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
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
  vi.unstubAllGlobals();
});

function Open() {
  return <output data-testid="palette">{usePalette().open ?? "closed"}</output>;
}
async function bar(path: string) {
  const root = createRootRoute({
    component: () => (
      <SurfaceHostProvider>
        <RouteControlsProvider>
          <AppBar />
          <Open />
        </RouteControlsProvider>
      </SurfaceHostProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path })]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

test("/pods says how many feed rows ask for a person, and the count opens the overlay", async () => {
  state.feed = {
    id: 2,
    tray: false,
    rows: [
      row("stored:a:1", "failed", "discarded"),
      row("thread:t1", "unread", "done"),
      // Working rows and staged Work stay in Activity: they raise no card and are not counted.
      row("thread:t2", "working", "running"),
      row("work:w1", "waits", "review"),
    ],
  };
  const view = await bar("/pods");
  const count = await screen.findByRole("button", { name: /^2 open: 1 failed, 1 unread\./ });
  expect(count.textContent).toBe("2 open");
  expect(
    view.container.querySelector("[data-notice-count]")?.getAttribute("data-notice-count"),
  ).toBe("2");
  expect(screen.getByTestId("palette").textContent).toBe("closed");
  fireEvent.click(count);
  await waitFor(() => expect(screen.getByTestId("palette").textContent).toBe("global"));
});

test("with nothing asking, the bar draws no count", async () => {
  state.feed = { id: 3, tray: false, rows: [row("thread:t2", "working", "running")] };
  const view = await bar("/pods");
  await screen.findByRole("navigation");
  expect(view.container.querySelector("[data-notice-count]")).toBeNull();
});

test.each<[string, string | null, string]>([
  ["done", null, "Full action receipt detail"],
  ["discarded", "Nothing to open: the file is gone", "C:/state/Work/pods.json"],
  [
    "stale",
    "No address yet: this receipt has no page",
    "The target document closed before binding",
  ],
])("%s keeps its full detail in the accessible tooltip", async (verb, refusal, detail) => {
  const { Ledger } = await import("./ledger");
  const { LEDGER_PRESENTATIONS } = await import("./ledger-model");
  state.feed = {
    id: 4,
    tray: false,
    rows: [{ ...row("detail", "failed", verb), refusal, detail, says: null }],
  };
  const view = render(<Ledger presentation={LEDGER_PRESENTATIONS.overlay} />);
  await waitFor(() => {
    const descriptions = [...view.container.querySelectorAll("[aria-description]")].map((el) =>
      el.getAttribute("aria-description"),
    );
    expect(descriptions).toContain(refusal ? `${refusal}\n${detail}` : detail);
  });
  expect(view.container.textContent).not.toContain(detail);
});
