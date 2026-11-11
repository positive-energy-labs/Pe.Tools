// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { PageTargetReading } from "@pe/agent-contracts";
type Frame = { kind: string; key: string; value?: unknown; error?: string };
/** The tab's one stream, stood in: the chip holds one `page-target` key on it. */
const stream = vi.hoisted(() => ({
  requests: [] as unknown[],
  send: (_frame: Frame) => {},
}));
vi.mock("#/host/resource-stream", () => ({
  peReadings: {
    subscribe: (request: unknown, listener: (frame: Frame) => void) => {
      stream.requests.push(request);
      stream.send = listener;
      return () => {};
    },
  },
}));
import { PageBindingChip } from "./chip";

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
  stream.requests.length = 0;
});
/** The bind link carries the Page as its subject: one `name` SubjectRef, `name:["todo"]` (slice 10). */
const PAGE = "%7B%22kind%22%3A%22ids%22%2C%22ids%22%3A%5B%22name%3A%5B%5C%22todo%5C%22%5D%22%5D%7D";
test("ADR 0021: a thread slot that writes names its document; no clock, no revoke control", async () => {
  await renderChip("/?target=project%3Aclinic&work=work-a");
  expect(stream.requests).toEqual([{ kind: "page-target", slug: "todo" }]);
  act(() => stream.send({ kind: "snapshot", key: "k", value: writes }));
  expect(await screen.findByText("MEP")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByRole("link", { name: "Bind…" }).getAttribute("href")).toBe(
    `/bind?page=${PAGE}&target=project%3Aclinic&work=work-a`,
  );
});
test("access-061/062: a disconnected Page reading immediately stops naming its document", async () => {
  await renderChip();
  act(() => stream.send({ kind: "snapshot", key: "k", value: writes }));
  await screen.findByText("MEP");
  expect(screen.getByRole("link", { name: "Bind…" }).getAttribute("href")).toBe(`/bind?page=${PAGE}`);
  act(() => stream.send({ kind: "stale", key: "k" }));
  await waitFor(() => expect(screen.queryByText("MEP")).toBeNull());
  expect(screen.getByText("unverified")).toBeTruthy();
});
