import { expect, test } from "vite-plus/test";
import { routeAddress } from "./route-address.ts";

test("chat accepts the kernel focus selection from router-decoded search", () => {
  const focus = Object.assign(Object.create(null), {
    kind: "focus", id: '["ducts-focus","cell:equipmentFlows:8108427:inputs"]',
  });
  const result = routeAddress("chat").read({ selected: [focus] });
  expect(result.page.selected).toEqual([focus]);
  expect(result.problems).toEqual([]);
});
