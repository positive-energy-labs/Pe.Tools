// @vitest-environment jsdom
/**
 * F-H6-7 (HOLD 6, BLOCKING): a Work holding `scope.proposal` crashed /families, the route AND the
 * Chat pane, with ""scope" is not valid JSON": the scope band's accept/deny asked the matrix's
 * per-cell lock for the root key `scope`, which is no family cell address.
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

import { cleanup } from "@testing-library/react";
import { afterEach } from "vite-plus/test";
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
                    // project-a Work r1 (HOLD 6): Pea's scope proposal, nothing staged.
                    scope: {
                      proposal: {
                        value: {
                          categoryNames: [],
                          familyNames: [DEMO_FAMILIES[0]!.familyName],
                          placementScope: "AllLoaded",
                        },
                      },
                    },
                    cells: {},
                    excluded: {},
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

afterEach(cleanup);

const mount = async (content: React.ReactNode, entry: string) => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => content }),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByText("Pea proposes")).toBeTruthy(), { timeout: 5_000 });
  await waitFor(() => expect(screen.getByRole("button", { name: "accept" })).toBeTruthy());
  expect(document.body.textContent).not.toMatch(/not valid JSON|route failed/);
};

test("the route draws Pea's scope proposal with its verbs, and does not crash", async () => {
  await mount(
    <FamiliesRouteContent target={AT} url />,
    `/families?target=${encodeURIComponent(AT)}`,
  );
}, 30_000);

test("the Chat pane (thread-bound) draws the same scope proposal, and does not crash", async () => {
  await mount(<FamiliesRouteContent thread="thread-1" />, "/");
}, 30_000);
