import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import { placeAdmittedVerbs } from "./admitted-placement";
test("placement validates rows and allowed union and preserves each invocation input", () => {
  const pane = {
    verbs: { row: "row", choose: "choose", allowed: ["read"] },
  } as unknown as RouteGraphJson["panes"][string];
  const invoke = vi.fn(),
    choose = vi.fn((row) => {
      expect(Object.isFrozen(row)).toBe(true);
      return [row.verb];
    });
  const schemas = { row: z.strictObject({ verb: z.string() }) },
    bodies = { choose: { run: choose } };
  const input = { ids: [42] },
    placed = placeAdmittedVerbs(pane, schemas, bodies, { verb: "read" }, input, invoke);
  input.ids[0] = 99;
  placed.read!();
  expect(invoke).toHaveBeenCalledWith("read", { ids: [42] });
  expect(() => placeAdmittedVerbs(pane, schemas, bodies, { verb: "write" }, {}, invoke)).toThrow(
    "Undeclared pane verb: write",
  );
  expect(() => placeAdmittedVerbs(pane, schemas, bodies, {}, {}, invoke)).toThrow();
  expect(invoke).toHaveBeenCalledOnce();
});
