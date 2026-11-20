import { expect, test } from "vite-plus/test";
import { SHEET_COMMANDS } from "@pe/agent-contracts/slots";
import { productExecutors } from "../src/product-executors.generated.ts";
import { detachedBridge } from "./effect-test.ts";

test("the shared sheet pair binds to each admitted Work owner's executor", () => {
  const { executors, sheets } = productExecutors(detachedBridge());
  expect([...sheets.keys()].sort()).toEqual(["duct-systems", "fans", "rooms"]);
  for (const [route, sheet] of sheets) {
    expect(sheet.id).toBe(route);
    expect(Object.keys(sheet.executors).sort()).toEqual(Object.values(SHEET_COMMANDS).sort());
  }
  expect(executors).toHaveProperty(["ducts.refresh"]);
  expect(executors).not.toHaveProperty([SHEET_COMMANDS.apply]);
});
