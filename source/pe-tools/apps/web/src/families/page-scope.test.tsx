// @vitest-environment jsdom
/**
 * F-J1-4 on the page (hold 3, 666a58e): /families at `?target=` with an applied scope saved in
 * Work and NO draft interaction must read the matrix and show the scoped families. Live, the
 * matrix sat at "0 families" for 45 s+ until the scope draft was touched. Here the host's long
 * matrix read makes the inventory Reading go stale while it runs, as a busy Revit does.
 */
import { expect, test, vi } from "vite-plus/test";
import { render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { address, readingKey, type ReadingRequest } from "@pe/agent-contracts";

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
      if (key === "revit.matrix.loaded-families") {
        // Revit is busy for the read: the inventory goes stale, then comes back, mid-read.
        (globalThis as { inventoryBlip?: () => void }).inventoryBlip?.();
        await new Promise((resolve) => setTimeout(resolve, 60));
        return { families: DEMO_FAMILIES, issues: [] };
      }
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
import { FamiliesRouteContent } from "#/routes/families";

const SESSION = "session-hosted";
const REF = { session: SESSION, openId: "open-1" };
const AT = address("C:\\Models\\MEP.rvt");

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
                      address: AT,
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
                    excludedIds: [],
                  },
                }
              : undefined;
      if (request.kind === "inventory")
        (globalThis as { inventoryBlip?: () => void }).inventoryBlip = () => {
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({ kind: "stale", key }) }), 0);
          setTimeout(
            () => this.onmessage?.({ data: JSON.stringify({ kind: "snapshot", key, value }) }),
            20,
          );
        };
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

test("the page at ?target= reads Work's saved scope on mount, with no draft interaction", async () => {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <FamiliesRouteContent target={AT} url />,
    }),
    history: createMemoryHistory({
      initialEntries: [`/families?target=${encodeURIComponent(AT)}`],
    }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  const family = DEMO_FAMILIES[0]!.familyName;
  await waitFor(() => expect(screen.getAllByText(family).length).toBeGreaterThan(0), {
    timeout: 5_000,
  });
  expect(document.body.textContent).not.toMatch(/resolved to no families/i);
  // One read answers it: the matrix never aborts itself on its own inventory blip.
  expect(calls.filter((key) => key === "revit.matrix.loaded-families")).toHaveLength(1);
}, 30_000);
