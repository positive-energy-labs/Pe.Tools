// @vitest-environment jsdom
/**
 * 27 (S-1/S-2): old Work `{ scope: <bare>, excluded: { "Alpha": { by: "person" } } }` salvages as
 * names plus the old scope. The fresh page offers both in the person's words; one press is one
 * human write (the scope staged, Alpha re-excluded as the person); dismiss writes nothing. Its own
 * file: a mount in another test's registry would answer from retained Readings.
 */
import { expect, test, vi } from "vite-plus/test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { readingKey, type ReadingRequest } from "@pe/agent-contracts";

vi.mock("#/host/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/host/client")>()),
  callHostRpc: (key: string) =>
    key === "revit.catalog.loaded-families"
      ? Promise.resolve({ families: [{ familyId: 1, familyName: "Alpha" }] })
      : Promise.reject(new Error(`no host in test: ${key}`)),
  callHostDynamic: () => Promise.reject(new Error("no host in test")),
}));
vi.mock("#/lib/token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/lib/token")>()),
  token: () => "currentColor",
}));

import { FamiliesRouteContent } from "#/routes/families";

const SESSION = "session-start-fresh-scope";
const UNREADABLE =
  "This route's saved Work is in a shape this version cannot read, so it was left untouched; it cannot be opened here.";

/** Flipped by the host's start-fresh answer; the next Work read is then an empty Work. */
let fresh = false;

/** The one wire: the document resolves and the Work Reading is the host's refusal. */
class WireSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    const keys = JSON.parse(new URL(url).searchParams.get("keys") ?? "[]") as ReadingRequest[];
    for (const request of keys) {
      const key = readingKey(request);
      const frame =
        request.kind === "inventory"
          ? {
              kind: "snapshot",
              key,
              value: {
                sessions: [
                  {
                    connected: true,
                    sessionId: SESSION,
                    openDocumentCount: 1,
                    openDocuments: [
                      { openId: "open-1", address: "C:\\Models\\Old.rvt", isFamilyDocument: false },
                    ],
                  },
                ],
              },
            }
          : request.kind === "work"
            ? fresh
              ? { kind: "snapshot", key, value: null }
              : { kind: "failure", key, error: UNREADABLE }
            : null;
      if (frame) setTimeout(() => this.onmessage?.({ data: JSON.stringify(frame) }), 0);
    }
  }
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { EventSource?: unknown }).EventSource = WireSource;

const SCOPE = {
  categoryNames: ["Air Terminals"],
  familyNames: ["Price LBP15A Exhaust"],
  placementScope: "AllLoaded",
};

test("the fresh page offers the old name-keyed exclusions and scope; one press is one human write", async () => {
  const posts: { url: string; body: { patches?: unknown } }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
    if (!init?.method || init.method === "GET")
      return new Response(
        JSON.stringify({
          from: fresh ? "aside:1" : "unreadable",
          value: { familyNames: ["Alpha"], familyIds: [], scope: SCOPE },
        }),
      );
    posts.push({ url, body: JSON.parse(init.body ?? "{}") });
    if (url.includes("/start-fresh")) fresh = true;
    return new Response(JSON.stringify({ ok: true, revision: posts.length }));
  });
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <FamiliesRouteContent target={SESSION} /> }),
    history: createMemoryHistory({ initialEntries: [`/families?target=${SESSION}`] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByText("unreadable", undefined, { timeout: 5_000 });

  fireEvent.click(screen.getByRole("button", { name: "start fresh" }));
  const held = await screen.findByLabelText("held back in the old Work", undefined, {
    timeout: 5_000,
  });
  expect(held.textContent).toContain("Alpha");
  expect(held.textContent).toContain("Air Terminals · Price LBP15A Exhaust · all loaded");
  fireEvent.click(screen.getByRole("button", { name: "start fresh? press again" }));
  await waitFor(() => expect(screen.queryByText("unreadable")).toBeNull(), { timeout: 5_000 });
  expect(posts).toHaveLength(1);

  const again = await screen.findByRole("button", { name: "restore these" }, { timeout: 5_000 });
  expect(document.body.textContent).toContain("the old Work held back Alpha");
  expect(document.body.textContent).toContain(
    "scoped Air Terminals · Price LBP15A Exhaust · all loaded",
  );
  expect(posts).toHaveLength(1);
  await act(async () => fireEvent.click(again));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(new URL(posts[1]!.url).pathname).toMatch(/\/route-state\/families\/apply$/);
  expect(posts[1]!.url).not.toContain("/agent/");
  expect(posts[1]!.body.patches).toEqual([
    { path: ["scope", "staged"], value: { value: SCOPE } },
    { path: ["excluded", "Alpha"], value: { by: "person" } },
  ]);
  await waitFor(() => expect(screen.queryByRole("button", { name: "restore these" })).toBeNull());
  vi.unstubAllGlobals();
}, 30_000);
