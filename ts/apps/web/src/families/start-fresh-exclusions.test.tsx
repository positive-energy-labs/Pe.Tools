// @vitest-environment jsdom
/**
 * 24: start fresh on `/families` never makes the person's exclusion list vanish unseen. The confirm
 * shows the old Work's exclusions read-only, by the names the catalog gives them now; after the
 * press, one line offers to hold them back again, and only that press writes them, as the
 * person's. Its own file: a mount in another test's registry would answer from retained Readings.
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

const SESSION = "session-start-fresh-exclusions";
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

test("start fresh shows the old exclusions by name, and only the person's press holds them back again", async () => {
  const gets: string[] = [];
  const posts: { url: string; body: { patches?: unknown } }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
    if (!init?.method || init.method === "GET") {
      gets.push(url);
      return new Response(
        JSON.stringify({ from: fresh ? "aside:1" : "unreadable", value: { familyIds: [1, 2] } }),
      );
    }
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

  // The confirm: read-only, by name as the catalog resolves each id now; nothing is written yet.
  fireEvent.click(screen.getByRole("button", { name: "start fresh" }));
  const held = await screen.findByLabelText("held back in the old Work", undefined, {
    timeout: 5_000,
  });
  expect(held.textContent).toContain("Alpha");
  expect(held.textContent).toContain("element 2 · no longer loaded");
  expect(posts).toHaveLength(0);
  expect(gets.every((url) => new URL(url).pathname.endsWith("/route-state/families/salvage"))).toBe(
    true,
  );
  expect(gets.some((url) => url.includes("/agent/"))).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "start fresh? press again" }));
  await waitFor(() => expect(screen.queryByText("unreadable")).toBeNull(), { timeout: 5_000 });
  expect(posts.map((post) => new URL(post.url).pathname)).toEqual([
    expect.stringMatching(/\/route-state\/families\/start-fresh$/),
  ]);

  // The fresh page offers it once; only the press writes, and only the names that resolve.
  const again = await screen.findByRole(
    "button",
    { name: "restore these" },
    {
      timeout: 5_000,
    },
  );
  expect(document.body.textContent).toContain(
    "the old Work held back Alpha, element 2 · no longer loaded",
  );
  await act(async () => fireEvent.click(again));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(new URL(posts[1]!.url).pathname).toMatch(/\/route-state\/families\/apply$/);
  expect(posts[1]!.url).not.toContain("/agent/");
  expect(posts[1]!.body.patches).toEqual([
    { path: ["excluded", "Alpha"], value: { by: "person" } },
  ]);
  await waitFor(() => expect(screen.queryByRole("button", { name: "restore these" })).toBeNull());
  vi.unstubAllGlobals();
}, 30_000);
