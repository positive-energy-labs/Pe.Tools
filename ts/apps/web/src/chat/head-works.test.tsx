// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vite-plus/test";
import { address, roomEditKey, roomsRouteState } from "@pe/agent-contracts";
import { publicRoutes, publicRoutesReady } from "../route/builtin-routes";
import { useHeadWorks } from "./head-works";

const reads = vi.hoisted(() => ({
  entries: [] as { work: { route: string; schema: unknown }; key: unknown }[],
  doc: null as unknown,
  route: "rooms",
}));
vi.mock("#/shell/use-work-handles", () => ({
  useWorkHandles: (entries: typeof reads.entries) => {
    reads.entries = entries;
    return entries.map(({ work }) => ({
      doc: work.route === reads.route ? reads.doc : null,
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
beforeAll(() => publicRoutesReady);

test("the chat head reads executable graph Work and cell families for addressed and unsaved documents", () => {
  reads.route = "rooms";
  const key = roomEditKey("room-a", "name");
  reads.doc = roomsRouteState.schema.parse({
    edits: { [key]: { edit: { value: "Pantry" } } },
  });
  const doc = { session: "session-one", openId: "unsaved-one" };
  const exits = { open: vi.fn(), planIn: vi.fn() };
  const rendered = renderHook(({ target }) => useHeadWorks(target, "Building", exits, doc), {
    initialProps: {
      target: address("C:/Models/Building.rvt") as ReturnType<typeof address> | null,
    },
  });
  expect(reads.entries.find((entry) => entry.work.route === "rooms")).toMatchObject({
    work: { schema: roomsRouteState.schema },
    key: { binding: "address", route: "rooms", target: "C:/Models/Building.rvt", from: doc },
  });
  expect(
    reads.entries.some((entry) => entry.work.route === "pods" || entry.work.route === "open"),
  ).toBe(false);
  const head = rendered.result.current.find((head) => head.route === "Rooms")!;
  expect(head.cells[key]?.edit?.value).toBe("Pantry");
  head.open?.();
  expect(exits.open).toHaveBeenCalledWith(expect.objectContaining({ route: "rooms", ok: true }));
  rendered.rerender({ target: null });
  expect(reads.entries.find((entry) => entry.work.route === "rooms")?.key).toEqual({
    binding: "open",
    route: "rooms",
    target: null,
    open: doc,
  });
});

test("admitted Families contributes a head row with its typed focus and exact recorded target", () => {
  reads.route = "families";
  reads.doc = { cells: { '["Family","Type","Parameter"]': { edit: { value: "changed" } } } };
  const document = { session: "original-session", openId: "original-open" };
  const exits = { open: vi.fn(), planIn: vi.fn() };
  const { result } = renderHook(() => useHeadWorks(null, "Building", exits, document));
  expect(reads.entries.filter(({ work }) => work.route === "families")).toHaveLength(1);
  const head = result.current.find((row) => row.route === "Families")!;
  expect(head).toBeDefined();
  expect(head.groupOf('["Family","Type","Parameter"]')).toEqual(
    publicRoutes.get("families")!.work!.cells[0]!.groupOf('["Family","Type","Parameter"]'),
  );
  head.open?.('["Family","Type","Parameter"]');
  expect(exits.open).toHaveBeenCalledWith(
    expect.objectContaining({
      route: "families",
      page: expect.objectContaining({ focus: '["Family","Type","Parameter"]' }),
      carry: expect.objectContaining({ target: JSON.stringify({ kind: "open", ref: document }) }),
    }),
  );
});
