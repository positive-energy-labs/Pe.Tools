// @vitest-environment jsdom
/**
 * The takeoffs cutover's old rows, on `/takeoffs` mounted whole: when the host refuses old-shape saved Work, the
 * Situation says the host's sentence. Its own file: a mount in another test's registry would be
 * answered by that test's retained Work Reading.
 */
import { expect, test, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { readingKey, type ReadingRequest } from "@pe/agent-contracts";

vi.mock("#/host/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/host/client")>()),
  callHostRpc: (key: string) => Promise.reject(new Error(`no host in test: ${key}`)),
  callHostDynamic: () => Promise.reject(new Error("no host in test")),
}));
vi.mock("#/lib/token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/lib/token")>()),
  token: () => "currentColor",
}));

import { TakeoffsRoute } from "#/takeoff/route";
import { manifest as takeoffsManifest } from "#/takeoff/manifest";

const SESSION = "session-takeoffs-old-work";
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

test("old-shape takeoffs Work fails closed on the shared path: the host's sentence, then start fresh", async () => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <TakeoffsRoute target={SESSION} /> }),
    history: createMemoryHistory({ initialEntries: [`/takeoffs?target=${SESSION}`] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  const status = await screen.findByText(
    (_, node) =>
      Boolean(node?.getAttribute("role") === "status" && node.textContent?.includes(UNREADABLE)),
    undefined,
    // A whole route mount; under a loaded full run it outlasts the default second.
    { timeout: 5_000 },
  );
  expect(status).toBeTruthy();
  expect(screen.getByText("unreadable")).toBeTruthy();

  // The human verb beside the sentence posts the host's human door once, never Pea's.
  const posts: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    posts.push(url);
    fresh = true;
    return new Response(JSON.stringify({ ok: true, revision: 1 }));
  });
  fireEvent.click(screen.getByRole("button", { name: "start fresh" }));
  await waitFor(() => expect(screen.queryByText("unreadable")).toBeNull(), { timeout: 5_000 });
  expect(posts).toHaveLength(1);
  expect(new URL(posts[0]).pathname).toMatch(/\/route-state\/takeoffs\/start-fresh$/);
  expect(posts[0]).not.toContain("/agent/");
  expect(screen.queryByText(UNREADABLE, { exact: false })).toBeNull();
  expect(screen.queryByRole("button", { name: "start fresh" })).toBeNull();
  // Pea's surface is the manifest's actions; start fresh is not one of them.
  expect(Object.keys(takeoffsManifest.actions ?? {})).not.toContain("start-fresh");
  vi.unstubAllGlobals();
});
