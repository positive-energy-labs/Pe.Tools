// @vitest-environment jsdom
import { stableFanKey } from "../ducts/sheet/model";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { citation, selection } from "@pe/kit/lang/attention";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Pointer } from "../../../../packages/agent-contracts/src/pointers.ts";

// The host list behind `pointers.list`/`pointers.dismiss`; the components read and dismiss through it.
let list: Pointer[] = [];
vi.mock("../host/catalog-client", () => ({
  callOp: vi.fn(async (_ctx: unknown, key: string, request: { thread: string; id?: string }) => {
    if (key === "pointers.dismiss") list = list.filter((p) => p.id !== request.id);
    return { threadId: request.thread, pointers: list };
  }),
}));
import { PointerCite, PointerList } from "./pointer-list";
import { pointerRefs } from "../ducts/identity";
import { WorkbenchContext } from "#/workbench/provider/thread-summary";
import { makeAtomRegistry } from "#/shell/owner";

afterEach(cleanup);
const snapshot = {
  nodes: [
    { id: 7, uniqueId: "u-7", connectors: [] },
    { id: 8, uniqueId: "u-8", connectors: [] },
  ],
  segments: [],
  systems: [],
} as unknown as DuctSnapshot;

test("a fan place maps to the snapshot unit's real element key; foreign text maps to nothing", () => {
  const place = { fan: JSON.stringify({ kind: "ids", ids: [stableFanKey({ uniqueId: "u-7", portIndex: 0 })] }) };
  expect(pointerRefs(place, snapshot, "s/o", () => "FC-1")).toEqual([
    { doc: "s/o", key: "e:7", name: "FC-1", number: 1 },
  ]);
  expect(pointerRefs({ fan: JSON.stringify({ kind: "ids", ids: [stableFanKey({ uniqueId: "u-9", portIndex: 0 })] }) }, snapshot, "s/o", () => null)).toEqual([]);
  expect(() => pointerRefs({ fan: "not json" }, snapshot, "s/o", () => null)).toThrow();
});

test("Pea's pointer is listed and cited inside the route; dismiss clears both; selection and URL never move", async () => {
  list = [
    {
      id: "p1",
      route: "fans",
      place: { fan: JSON.stringify({ kind: "ids", ids: [stableFanKey({ uniqueId: "u-7", portIndex: 0 })] }) },
      label: "FC-1 fan flow",
      at: "2026-11-05T00:00:00Z",
    },
  ];
  const registry = makeAtomRegistry();
  const url = window.location.href;
  const selected = registry.get(selection("s/o"));
  render(
    <RegistryContext.Provider value={registry}>
      <WorkbenchContext.Provider value={{ currentThreadId: "t1" } as never}>
        <PointerList route="fans" />
        <PointerCite route="fans" refs={(place) => pointerRefs(place, snapshot, "s/o", () => "FC-1")} />
      </WorkbenchContext.Provider>
    </RegistryContext.Provider>,
  );
  await act(async () => {});
  expect(screen.getByText("Pea is pointing at FC-1 fan flow")).toBeTruthy();
  expect(registry.get(citation)).toMatchObject({
    owner: "pointers:fans",
    focus: null,
    refs: [{ doc: "s/o", key: "e:7" }],
  });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Dismiss FC-1 fan flow" })));
  await act(async () => {});
  expect(screen.queryByText(/FC-1 fan flow/)).toBeNull();
  expect(registry.get(citation)).toBeNull();
  expect(registry.get(selection("s/o"))).toEqual(selected);
  expect(window.location.href).toBe(url);
});
