// @vitest-environment jsdom
/**
 * The takeoffs cutover's old rows, on `/takeoffs` mounted whole: when the host refuses old-shape saved Work, the
 * Situation says the host's sentence. Its own file: a mount in another test's registry would be
 * answered by that test's retained Work Reading.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { OLDER_WORK, UNREADABLE_WORK, readingKey, type ReadingRequest } from "@pe/agent-contracts";

// The retained embedded mount does not need app chrome or other routes mid-cutover.
vi.mock("../routes/__root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { Route: createRootRoute() };
});

vi.mock("#/host/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/host/client")>()),
  callHostRpc: (key: string) => Promise.reject(new Error(`no host in test: ${key}`)),
}));
vi.mock("@pe/kit/lib/token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pe/kit/lib/token")>()),
  token: () => "currentColor",
}));

import { TakeoffsRoute } from "#/takeoff/route";
import { takeoffGraph } from "#/takeoff/graph";

const SESSION = "session-takeoffs-old-work";
let failure = OLDER_WORK;

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
              : { kind: "failure", key, error: failure }
            : null;
      if (frame) setTimeout(() => this.onmessage?.({ data: JSON.stringify(frame) }), 0);
    }
  }
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test.each([OLDER_WORK, UNREADABLE_WORK])(
  "takeoffs preserves the host refusal and only resets provably older Work: %s",
  async (message) => {
    failure = message;
    fresh = false;
    vi.stubGlobal("EventSource", WireSource);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const posts: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("start-fresh")) {
        posts.push(String(url));
        fresh = true;
        return Response.json({ ok: true, revision: 1 });
      }
      return Response.json(null);
    });
    const router = createRouter({
      routeTree: createRootRoute({ component: () => <TakeoffsRoute target={SESSION} /> }),
      history: createMemoryHistory({ initialEntries: [`/takeoffs?target=${SESSION}`] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    expect(await screen.findByText(message)).toBeTruthy();
    if (message === UNREADABLE_WORK) {
      expect(screen.queryByRole("button", { name: "Start fresh" })).toBeNull();
      expect(posts).toEqual([]);
      return;
    }
    fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));
    const review = await screen.findByRole("dialog", { name: "Start fresh review" });
    expect(screen.getByText(message)).toBeTruthy();
    fireEvent.click(within(review).getByRole("button", { name: "Commit Start fresh" }));
    await waitFor(() => expect(screen.queryByText(message)).toBeNull());
    expect(posts).toHaveLength(1);
    expect(new URL(posts[0]!, "http://host").pathname).toMatch(
      /\/route-state\/takeoffs\/start-fresh$/,
    );
    expect(posts[0]).not.toContain("/agent/");
    expect(takeoffGraph.verbs).not.toHaveProperty("work.start-fresh");
  },
);
