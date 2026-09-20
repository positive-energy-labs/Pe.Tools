// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { appAtomRegistry } from "#/route";
import { LiveScheduleGridWorkspace } from "./live";
import type { ScheduleGridState } from "./workspace";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));

class DeadSource {
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

test("a retained schedule reading adopts its workspace before the first cell edit", async () => {
  window.history.replaceState({}, "", "/schedules?demo=push");
  vi.stubGlobal("EventSource", DeadSource);
  let state: ScheduleGridState | undefined;
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <RegistryContext.Provider value={appAtomRegistry}>
          <LiveScheduleGridWorkspace
            framed
            workspaceId=""
            render={(next) => {
              state = next;
              return null;
            }}
          />
        </RegistryContext.Provider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/schedules?demo=push"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);

  await vi.waitFor(() => expect(state?.snapshot?.scheduleId).toBe(481223));
  await vi.waitFor(() =>
    expect((router.state.location.search as { schedule?: string }).schedule).toBe("demo-schedule"),
  );
});
