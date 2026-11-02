import { expect, test } from "vite-plus/test";
import { flowWriteSlot } from "./flow-write-slot.ts";

test("flow writes use each element's observed slot", () => {
  expect(flowWriteSlot(1, "revit:Flow")).toBe("revit:Flow");
  expect(flowWriteSlot(2, "PE_M_Fan_AirFlow")).toBe("PE_M_Fan_AirFlow");
  expect(flowWriteSlot(3, "Actual Supply Air Flow", "Actual Supply Air Flow")).toBe(
    "Actual Supply Air Flow",
  );
});
test("a missing or mismatched target refuses before native apply", () => {
  expect(() => flowWriteSlot(1, "revit:Flow", "PE_M_Grd_AirFlow")).toThrow("Element 1");
  expect(() => flowWriteSlot(1, null)).toThrow("no observed airflow parameter");
});
