// @vitest-environment jsdom
/**
 * Obligation 12 on `/families`, mounted whole: when the host refuses old-shape saved Work, the
 * Situation says the host's sentence. Its own file: a mount in another test's registry would be
 * answered by that test's retained Work Reading.
 */
import { expect, test, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
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

const SESSION = "session-old-work";
const UNREADABLE =
  "This route's saved Work is in a shape this version cannot read, so it was left untouched; it cannot be opened here.";

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
            ? { kind: "failure", key, error: UNREADABLE }
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
  const status = await screen.findByText((_, node) =>
    Boolean(node?.getAttribute("role") === "status" && node.textContent?.includes(UNREADABLE)),
  );
  expect(status).toBeTruthy();
  expect(screen.getByText("unreadable")).toBeTruthy();
});
