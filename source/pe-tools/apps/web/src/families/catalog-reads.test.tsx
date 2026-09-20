// @vitest-environment jsdom
/**
 * w8-revit trip 9: `/families` dispatched `revit.catalog.loaded-families` twice a second, because
 * the reads keyed on the resolved ref object and the inventory reading rebuilds it on every move
 * (a catalog dispatch is one). Here the inventory moves eight times on the same document; the
 * categories come from field-options once, and one scope change reads the catalog once.
 */
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { familiesRouteState, readingKey, type ReadingRequest } from "@pe/agent-contracts";

let hostCalls: { key: string; input: unknown }[] = [];
vi.mock("#/host/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/host/client")>();
  return {
    ...actual,
    callHostRpc: (key: string, input: unknown) => {
      hostCalls.push({ key, input });
      if (key === "revit.catalog.field-options")
        return Promise.resolve({
          sourceKey: "category-names",
          mode: "Suggestion",
          allowsCustomValue: false,
          items: [
            { value: "Sprinklers", label: "Sprinklers" },
            { value: "Duct Fittings", label: "Duct Fittings" },
          ],
        });
      if (key === "revit.catalog.loaded-families")
        return Promise.resolve({
          families: [{ familyId: 1, familyName: "Elbow", categoryName: "Duct Fittings" }],
        });
      return Promise.reject(new Error(`no host in test: ${key}`));
    },
    callHostDynamic: () => Promise.reject(new Error("no host in test")),
  };
});
vi.mock("#/lib/token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/lib/token")>()),
  token: () => "currentColor",
}));

import { FamiliesRouteContent } from "#/routes/families";

const SESSION = "session-553a4c85413fe3ae";
const doc = familiesRouteState.schema.parse({});

class WireSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  constructor(url: string) {
    const keys = JSON.parse(new URL(url).searchParams.get("keys") ?? "[]") as ReadingRequest[];
    const send = (delay: number, frame: unknown) =>
      this.timers.push(setTimeout(() => this.onmessage?.({ data: JSON.stringify(frame) }), delay));
    for (const request of keys) {
      const key = readingKey(request);
      if (request.kind === "receipts") send(0, { kind: "snapshot", key, value: [] });
      // Same document, a new observation time: what the state-sync after every dispatch publishes.
      if (request.kind === "inventory")
        for (const delay of [0, 40, 80, 120, 160, 400, 440, 480])
          send(delay, {
            kind: "snapshot",
            key,
            value: {
              sessions: [
                {
                  connected: true,
                  sessionId: SESSION,
                  activeDocumentObservedAtUnixMs: 1_800_000_000_000 + delay,
                  openDocumentCount: 1,
                  openDocuments: [
                    {
                      openId: "open-1",
                      address: "C:\\Models\\projectA.rvt",
                      isFamilyDocument: false,
                    },
                  ],
                },
              ],
            },
          });
      if (request.kind === "work") send(0, { kind: "snapshot", key, value: { doc, revision: 1 } });
    }
  }
  close() {
    for (const timer of this.timers) clearTimeout(timer);
  }
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { EventSource?: unknown }).EventSource = WireSource;

beforeEach(() => {
  hostCalls = [];
  window.history.replaceState({}, "", `/families?target=${SESSION}`);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const count = (key: string) => hostCalls.filter((call) => call.key === key).length;

test("categories read once from field-options; one scope change reads the catalog once", async () => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <FamiliesRouteContent target={SESSION} /> }),
    history: createMemoryHistory({ initialEntries: [`/families?target=${SESSION}`] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  const trigger = await screen.findByRole(
    "button",
    { name: "draft categories" },
    // The whole route mounts first; under a full parallel run that is slower than 1s.
    { timeout: 5000 },
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
  expect(count("revit.catalog.field-options")).toBe(1);
  expect(hostCalls.find((call) => call.key === "revit.catalog.field-options")?.input).toEqual({
    sourceKey: "category-names",
  });
  expect(count("revit.catalog.loaded-families")).toBe(0);

  await act(async () => fireEvent.click(trigger));
  const search = await screen.findByLabelText("draft categories search");
  await act(async () => fireEvent.change(search, { target: { value: "Duct" } }));
  await act(async () => fireEvent.keyDown(search, { key: "Enter" }));
  await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
  expect(count("revit.catalog.loaded-families")).toBe(1);
  expect(count("revit.catalog.field-options")).toBe(1);
  // A whole-route mount plus two real waits: over 5s under a loaded full run.
}, 15_000);
