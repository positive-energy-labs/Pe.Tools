// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { address, roomEditKey, roomsRouteState } from "@pe/agent-contracts";
import { roomsGraph } from "#/rooms/graph";
import { useHeadWorks } from "./head-works";

const reads = vi.hoisted(() => ({
  entries: [] as { graph: { key: string; work: unknown }; key: unknown }[],
  doc: null as unknown,
}));
vi.mock("#/shell/use-work-handles", () => ({
  useWorkHandles: (entries: typeof reads.entries) => {
    reads.entries = entries;
    return entries.map(({ graph }) => ({
      doc: graph.key === "rooms" ? reads.doc : null,
      revision: 3,
      stale: false,
      pending: [],
      write: vi.fn(),
      reload: vi.fn(),
    }));
  },
}));
vi.mock("../routes/__root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { Route: createRootRoute() };
});
afterEach(cleanup);

test("the chat head reads executable graph Work and cell families for addressed and unsaved documents", () => {
  const key = roomEditKey("room-a", "name");
  reads.doc = roomsRouteState.schema.parse({
    edits: { [key]: { suggestion: { value: "Pantry" } } },
  });
  const doc = { session: "session-one", openId: "unsaved-one" };
  const exits = { open: vi.fn(), planIn: vi.fn() };
  const rendered = renderHook(({ target }) => useHeadWorks(target, "Building", exits, doc), {
    initialProps: {
      target: address("C:/Models/Building.rvt") as ReturnType<typeof address> | null,
    },
  });
  expect(reads.entries.find((entry) => entry.graph.key === "rooms")).toMatchObject({
    graph: { work: roomsGraph.work },
    key: { binding: "address", route: "rooms", target: "C:/Models/Building.rvt", from: doc },
  });
  expect(
    reads.entries.some((entry) => entry.graph.key === "pods" || entry.graph.key === "open"),
  ).toBe(false);
  const head = rendered.result.current.find((head) => head.route === "Rooms")!;
  expect(head.cells[key]?.suggestion?.value).toBe("Pantry");
  head.open?.();
  expect(exits.open).toHaveBeenCalledWith(expect.objectContaining({ route: "rooms", ok: true }));
  rendered.rerender({ target: null });
  expect(reads.entries.find((entry) => entry.graph.key === "rooms")?.key).toEqual({
    binding: "open",
    route: "rooms",
    target: null,
    open: doc,
  });
});
