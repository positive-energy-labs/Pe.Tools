// @vitest-environment jsdom
/**
 * e2e findings 8 and 9: the hosted families pane says what is actually missing. With the bridge
 * connected and no document chosen it says so, never "the bridge is disconnected"; while the
 * category read is in flight it never says the read "succeeded and reported none".
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { readingKey, type ReadingRequest } from "@pe/agent-contracts";

vi.mock("#/host/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/host/client")>()),
  // Every host call stays in flight: the category read never answers.
  callHostRpc: () => new Promise(() => {}),
  callHostDynamic: () => new Promise(() => {}),
}));
vi.mock("#/lib/token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/lib/token")>()),
  token: () => "currentColor",
}));

import { ChatHosted } from "#/route/situation";
import { FamiliesRouteContent } from "#/routes/families";

const REF = { session: "session-hosted", openId: "open-1" };
let bound: typeof REF | null = null;

class WireSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    const keys = JSON.parse(new URL(url).searchParams.get("keys") ?? "[]") as ReadingRequest[];
    for (const request of keys) {
      const value =
        request.kind === "inventory"
          ? {
              sessions: [
                {
                  connected: true,
                  sessionId: REF.session,
                  openDocumentCount: 1,
                  openDocuments: [
                    {
                      openId: REF.openId,
                      title: "MEP",
                      address: "C:\\M.rvt",
                      isFamilyDocument: false,
                    },
                  ],
                },
              ],
            }
          : request.kind === "thread-head"
            ? { defaultTarget: bound ? { kind: "open", ref: bound } : null, revision: 1 }
            : request.kind === "work"
              ? { revision: 1, doc: { scope: {}, cells: {}, excluded: {} } }
              : undefined;
      if (value !== undefined)
        setTimeout(() => {
          const key = readingKey(request);
          this.onmessage?.({ data: JSON.stringify({ kind: "snapshot", key, value }) });
        }, 0);
    }
  }
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { EventSource?: unknown }).EventSource = WireSource;
afterEach(cleanup);

const mount = async () => {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ChatHosted.Provider value>
          <FamiliesRouteContent thread="T" />
        </ChatHosted.Provider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/chat?thread=T&plugin=families"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByText("families in scope", undefined, { timeout: 5_000 });
  await new Promise((resolve) => setTimeout(resolve, 200));
};

test("8 · a connected bridge with no document chosen says choose a document", async () => {
  bound = null;
  await mount();
  await waitFor(() => expect(document.body.textContent).toContain("no document chosen"));
  expect(document.body.textContent).not.toMatch(/bridge is disconnected/);
  expect(document.body.textContent).not.toMatch(/reported none/);
}, 30_000);

test("9 · a category read in flight never says it reported none", async () => {
  bound = REF;
  await mount();
  expect(document.body.textContent).not.toMatch(/reported none/);
}, 30_000);
