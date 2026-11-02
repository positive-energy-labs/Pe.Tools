import { expect, test, vi } from "vite-plus/test";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { DuctsHeal } from "@pe/host-contracts/generated";
import { healSnapshot, healedCellPaths } from "../src/ducts-actions.ts";

const snapshot = (value: object) => ({ nodes: [], segments: [], systems: [], groups: [], ...value }) as unknown as DuctSnapshot;
test("heal preparation crosses the geometry gate with bounded seeds, metadata roster and scoped systems", async () => {
  const scoped = snapshot({ groups: [{ id: "g10" }] });
  const read = vi.fn(async (selector: Record<string, unknown>) => {
    // OpCallGate's ducts.snapshot narrowing rule; document geometry is forbidden.
    expect(["ids", "roster", "systems", "from"]).toContain(selector.kind);
    if (selector.kind === "ids") return snapshot({ nodes: [{ id: 10, systemName: "Supply" }] });
    if (selector.kind === "roster") return snapshot({ systems: [{ id: 1, name: "Supply" }, { id: 2, name: "Other" }] });
    return scoped;
  });
  expect(await healSnapshot(["g10"], read)).toBe(scoped);
  expect(read.mock.calls.map(([selector]) => selector)).toEqual([
    { kind: "ids", ids: [10] }, { kind: "roster" }, { kind: "systems", systemIds: [1] },
  ]);
  await expect(healSnapshot([], read)).rejects.toThrow("valid writeIntent.groups");
});

test("heal retires its consumed intent only after every requested item is receipt-confirmed", () => {
  const input = { groups: [{ group: "g10", items: [{ key: "cap:10:0" }] }] };
  const result = { previewOnly: false, groups: [{ group: "g10", outcome: "healed", items: [{ key: "cap:10:0", outcome: "healed" }] }] } as DuctsHeal.Res.Response;
  expect(healedCellPaths(input, result)).toEqual([["writeIntent"]]);
  expect(healedCellPaths(input, { ...result, previewOnly: true })).toEqual([]);
  expect(healedCellPaths(input, { ...result, groups: [] })).toEqual([]);
  expect(healedCellPaths(input, { ...result, groups: [{ ...result.groups[0]!, items: [] }] })).toEqual([]);
  expect(healedCellPaths(input, { ...result, groups: [{ ...result.groups[0]!, outcome: "refused" }] })).toEqual([]);
});
