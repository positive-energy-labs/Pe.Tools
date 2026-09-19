// @vitest-environment jsdom
/**
 * Obligation 12 on `/families`, mounted whole: when the host refuses old-shape saved Work, the
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

import { FamiliesRouteContent } from "#/routes/families";
import { manifest as familiesManifest } from "#/families/manifest";

const SESSION = "session-old-work";
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

test("old-shape saved Work reaches the Situation as the host's sentence, not a blank route", async () => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <FamiliesRouteContent target={SESSION} /> }),
    history: createMemoryHistory({ initialEntries: [`/families?target=${SESSION}`] }),
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

  // F-J6-1: the refusal sentence is the only instruction. The Work-bearing controls are inert,
  // and the empty-Work instruction is not drawn.
  const placement = screen.getByRole("button", { name: "placement filter" });
  expect(
    placement.hasAttribute("disabled") || placement.getAttribute("aria-disabled") === "true",
  ).toBe(true);
  const applyScope = screen.getByRole("button", { name: /apply scope/ });
  expect(
    applyScope.hasAttribute("disabled") || applyScope.getAttribute("aria-disabled") === "true",
  ).toBe(true);
  expect(document.body.textContent).not.toContain("press “apply scope”");
  expect(document.body.textContent).toContain("the saved Work cannot be read");

  // F-R4-1 in the Situation (fixture look 12): the unresolved and staged lines live in one fixed,
  // self-scrolling slot, so a refusal or a first stage never grows the head over the grid.
  const slot = document.querySelector<HTMLElement>("[data-slot='situation-band']");
  expect(slot?.className).toMatch(/(^|\s)h-\S+/);
  expect(slot?.className).toMatch(/overflow-y-auto/);
  expect(slot?.textContent).toContain(UNREADABLE);

  // The human verb beside the sentence posts the host's human door once, never Pea's.
  const posts: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string }) => {
    // The fresh page reads the route's salvage (a GET); this old Work declares none to carry.
    if (!init?.method || init.method === "GET") return new Response("{}", { status: 404 });
    posts.push(url);
    fresh = true;
    return new Response(JSON.stringify({ ok: true, revision: 1 }));
  });
  fireEvent.click(screen.getByRole("button", { name: "start fresh" }));
  // The confirm: the first press asks, the second sets the old Work aside.
  fireEvent.click(screen.getByRole("button", { name: "start fresh? press again" }));
  await waitFor(() => expect(screen.queryByText("unreadable")).toBeNull(), { timeout: 5_000 });
  expect(posts).toHaveLength(1);
  expect(new URL(posts[0]).pathname).toMatch(/\/route-state\/families\/start-fresh$/);
  expect(posts[0]).not.toContain("/agent/");
  expect(screen.queryByText(UNREADABLE, { exact: false })).toBeNull();
  expect(screen.queryByRole("button", { name: "start fresh" })).toBeNull();
  // Pea's surface is the manifest's actions; start fresh is not one of them.
  expect(Object.keys(familiesManifest.actions ?? {})).not.toContain("start-fresh");
  vi.unstubAllGlobals();
});
