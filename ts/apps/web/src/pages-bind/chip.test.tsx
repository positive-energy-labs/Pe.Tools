// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
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
const rw: PageTargetReading = {
  page: "page:@pages/todo",
  slot: "default",
  binding: { kind: "thread", thread: "t" },
  resolution: {
    kind: "resolved",
    target: { kind: "document", ref: { session: "S", openId: "A" } },
  },
  document: { session: "S", openId: "A", title: "MEP" },
  write: { kind: "rw", thread: "t", expiresAt: "2026-10-13T13:00:00.000Z" },
  hostNow: "2026-10-13T12:18:00.000Z",
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});
test("access-007/008: chrome paints host time, revokes once, and refreshes the binding", async () => {
  vi.stubGlobal("EventSource", Stream);
  mocks.read.mockResolvedValue(rw);
  mocks.fetch.mockResolvedValue(Response.json({}));
  render(<PageBindingChip slug="todo" />);
  expect(await screen.findByText("rw · 42m")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Bind…" }).getAttribute("href")).toBe("/bind?page=todo");
  mocks.read.mockResolvedValue({
    ...rw,
    write: {
      kind: "read",
      refusal: { code: "grant.revoked", door: "/pages/todo/act", reason: "revoked" },
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Revoke Page rw" }));
  await waitFor(() =>
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(
      "/pe/scope/t/revoke",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  expect(await screen.findByText("read")).toBeTruthy();
});
test("access-061/062: a disconnected Page reading immediately stops painting rw", async () => {
  vi.stubGlobal("EventSource", Stream);
  mocks.read.mockResolvedValue(rw);
  render(<PageBindingChip slug="todo" />);
  await screen.findByText("rw · 42m");
  Stream.current.onerror?.();
  await waitFor(() => expect(screen.queryByText("rw · 42m")).toBeNull());
  expect(screen.getByText("unverified")).toBeTruthy();
});
