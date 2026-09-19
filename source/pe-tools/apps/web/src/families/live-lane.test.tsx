// @vitest-environment jsdom
/**
 * `/families?target=<session>` must mount without React's "Maximum update depth exceeded" while
 * the host is connected, the session is bound to one open project, the Work read answers null and
 * then a document, and the capture Readings are still pending.
 */
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  actionStatusSchema,
  familiesRouteState,
  readingKey,
  type ReadingRequest,
} from "@pe/agent-contracts";

let hostCalls: string[] = [];
vi.mock("#/host/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/host/client")>();
  return {
    ...actual,
    callHostRpc: (key: string) => {
      hostCalls.push(key);
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
const OPEN_ID = "open-1";
const ADDRESS = "C:\\Models\\projectA.rvt";
const doc = familiesRouteState.schema.parse({});
const APPLY_ID = "families-apply-1";
const applyStatus = actionStatusSchema.parse({
  kind: "workflow",
  id: APPLY_ID,
  key: "families.apply",
  actor: "human",
  destination: { kind: "document", ref: { session: SESSION, openId: OPEN_ID } },
  request: {},
  bases: {},
  startedAt: "2026-09-14T00:00:00Z",
  publication: { state: "unrequested" },
  state: "succeeded",
});
let receiptRequests: Extract<ReadingRequest, { kind: "receipts" }>[] = [];

/** The one wire, answered from the test: inventory and Work land, the capture streams never do. */
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
      if (request.kind === "receipts") {
        receiptRequests.push(request);
        if (!request.id) send(0, { kind: "snapshot", key, value: [applyStatus] });
      }
      if (request.kind === "inventory")
        send(0, {
          kind: "snapshot",
          key,
          value: {
            sessions: [
              {
                connected: true,
                sessionId: SESSION,
                openDocumentCount: 1,
                openDocuments: [{ openId: OPEN_ID, address: ADDRESS, isFamilyDocument: false }],
              },
            ],
          },
        });
      if (request.kind === "work") {
        send(0, { kind: "snapshot", key, value: null });
        send(30, { kind: "snapshot", key, value: { doc, revision: 1 } });
      }
    }
  }
  close() {
    for (const timer of this.timers) clearTimeout(timer);
  }
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { EventSource?: unknown }).EventSource = WireSource;

let errors: string[] = [];
beforeEach(() => {
  errors = [];
  hostCalls = [];
  receiptRequests = [];
  window.history.replaceState({}, "", `/families?target=${SESSION}`);
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("the families live lane mounts without an update-depth loop", async () => {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <FamiliesRouteContent target={SESSION} /> }),
    history: createMemoryHistory({ initialEntries: [`/families?target=${SESSION}`] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole("heading", { name: "Families" })).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const depth = errors.filter((line) => /Maximum update depth/.test(line));
  expect(depth, depth.join("\n")).toEqual([]);
  expect(receiptRequests).toContainEqual({
    kind: "receipts",
    target: { session: SESSION, openId: OPEN_ID },
  });
  expect(receiptRequests).toContainEqual({ kind: "receipts", id: APPLY_ID });
  expect(hostCalls).toContain("revit.catalog.field-options");
  expect(hostCalls).not.toContain("revit.catalog.loaded-families");
  expect(hostCalls).not.toContain("host.status");
});
