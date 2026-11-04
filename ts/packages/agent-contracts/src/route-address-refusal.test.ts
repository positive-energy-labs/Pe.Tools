import { expect, test } from "vite-plus/test";
import { routeAddress } from "./route-address.ts";

test("a router-decoded focus object is refused by the legacy text selection without throwing", () => {
  const focus = Object.assign(Object.create(null), {
    kind: "focus", id: '["ducts-focus","cell:equipmentFlows:8108427:inputs"]',
  });
  const result = routeAddress("pea").read({ selected: [focus] });
  expect(result.page.selected).toEqual([]);
  expect(result).toMatchObject({ problems: [{ kind: "non-text", field: "selected" }] });
});
