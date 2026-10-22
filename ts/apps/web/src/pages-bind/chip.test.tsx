// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { PageTargetReading } from "@pe/agent-contracts";
const mocks = vi.hoisted(() => ({ read: vi.fn(), fetch: vi.fn() }));
vi.mock("./client", () => ({ readPageTarget: mocks.read }));
vi.mock("#/host/runtime", () => ({
  hostFetch: mocks.fetch,
  runtimeStreamUrl: (url: string) => url,
}));
import { PageBindingChip } from "./chip";

class Stream extends EventTarget {
  static current: Stream;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    super();
    Stream.current = this;
  }
  close() {}
}
const writes: PageTargetReading = {
  page: "page:@pages/todo",
  slot: "default",
  binding: { kind: "thread", thread: "t" },
  resolution: {
    kind: "resolved",
    target: { kind: "document", ref: { session: "S", openId: "A" } },
  },
  document: { session: "S", openId: "A", title: "MEP" },
  write: { kind: "thread", thread: "t" },
};
async function renderChip(entry = "/") {
  vi.stubGlobal("scrollTo", vi.fn());
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <PageBindingChip slug="todo" /> }),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
test("ADR 0021: a thread slot that writes names its document; no clock, no revoke control", async () => {
  vi.stubGlobal("EventSource", Stream);
  mocks.read.mockResolvedValue(writes);
  await renderChip("/?target=project%3Aclinic&work=work-a");
  expect(await screen.findByText("MEP")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByRole("link", { name: "Bind…" }).getAttribute("href")).toBe(
    "/bind?page=todo&target=project%3Aclinic&work=work-a",
  );
});
test("access-061/062: a disconnected Page reading immediately stops naming its document", async () => {
  vi.stubGlobal("EventSource", Stream);
  mocks.read.mockResolvedValue(writes);
  await renderChip();
  await screen.findByText("MEP");
  expect(screen.getByRole("link", { name: "Bind…" }).getAttribute("href")).toBe("/bind?page=todo");
  Stream.current.onerror?.();
  await waitFor(() => expect(screen.queryByText("MEP")).toBeNull());
  expect(screen.getByText("unverified")).toBeTruthy();
});
