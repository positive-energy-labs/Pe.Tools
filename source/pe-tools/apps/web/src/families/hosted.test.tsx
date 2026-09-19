// @vitest-environment jsdom
/**
 * F-J1-4: the Chat-hosted /families (thread-bound, no `?target`, a `focus` from the head) must read
 * the same applied scope and Readings as the page: the matrix shows the scoped families, the
 * category read settles, and a focus filters rows without ever emptying the table. Its own file:
 * a mount in another test's registry would be answered by that test's retained Readings.
 */
import { expect, test, vi } from "vite-plus/test";
import { render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { readingKey, type ReadingRequest } from "@pe/agent-contracts";

const calls = vi.hoisted(() => [] as string[]);
vi.mock("#/host/client", async (importOriginal) => {
  const { DEMO_FAMILIES } = await import("#/families/seeds");
  return {
    ...(await importOriginal<typeof import("#/host/client")>()),
    callHostRpc: async (key: string) => {
      calls.push(key);
      if (key === "revit.catalog.field-options")
        return { items: [{ value: "Mechanical Equipment" }] };
      if (key === "revit.catalog.loaded-families")
        return { families: DEMO_FAMILIES.map((f) => ({ familyName: f.familyName })) };
      if (key === "revit.matrix.loaded-families") return { families: DEMO_FAMILIES, issues: [] };
      throw new Error(`no host in test: ${key}`);
    },
    callHostDynamic: () => Promise.reject(new Error("no host in test")),
  };
});
vi.mock("#/lib/token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/lib/token")>()),
  token: () => "currentColor",
}));

import { DEMO_FAMILIES } from "#/families/seeds";
import { ChatFocus, ChatHosted } from "#/route/situation";
import { FamiliesRouteContent } from "#/routes/families";

const SESSION = "session-hosted";
const REF = { session: SESSION, openId: "open-1" };

class WireSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    const keys = JSON.parse(new URL(url).searchParams.get("keys") ?? "[]") as ReadingRequest[];
    for (const request of keys) {
      const key = readingKey(request);
      const value =
        request.kind === "inventory"
          ? {
              sessions: [
                {
                  connected: true,
                  sessionId: SESSION,
                  openDocumentCount: 1,
                  openDocuments: [
                    {
                      openId: "open-1",
                      title: "MEP",
                      address: "C:\\Models\\MEP.rvt",
                      isFamilyDocument: false,
                    },
                  ],
                },
              ],
            }
          : request.kind === "thread-head"
            ? { defaultTarget: { kind: "open", ref: REF }, revision: 1 }
            : request.kind === "work"
              ? {
                  revision: 3,
                  doc: {
                    scope: {
                      categoryNames: ["Mechanical Equipment"],
                      familyNames: [],
                      placementScope: "AllLoaded",
                    },
                    cells: {},
                    excluded: {},
                  },
                }
              : undefined;
      if (value !== undefined)
        setTimeout(
          () => this.onmessage?.({ data: JSON.stringify({ kind: "snapshot", key, value }) }),
          0,
        );
    }
  }
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { EventSource?: unknown }).EventSource = WireSource;

test("the Chat-hosted families pane shows the page's scoped families, and its reads settle", async () => {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ChatHosted.Provider value>
          <ChatFocus.Provider value={["View Description"]}>
            <FamiliesRouteContent thread="T" />
          </ChatFocus.Provider>
        </ChatHosted.Provider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/chat?thread=T&plugin=families"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  const family = DEMO_FAMILIES[0]!.familyName;
  await waitFor(() => expect(screen.getAllByText(family).length).toBeGreaterThan(0), {
    timeout: 5_000,
  });
  expect(document.body.textContent).not.toMatch(/resolved to no families/i);
  expect(document.body.textContent).not.toMatch(/reading categories/i);
  expect(calls).toContain("revit.matrix.loaded-families");
  // The focus names a parameter nothing is pending under: it filters nothing, and says so.
  expect(document.body.textContent).toContain("nothing pending under View Description");
  expect(document.body.textContent).not.toMatch(/rows in scope are filtered out/);
}, 30_000);
