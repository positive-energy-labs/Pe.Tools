import { expect, test } from "vite-plus/test";
import { scheduleCellBindingSchema } from "../src/index.ts";

const target = {
  elementId: 7,
  parameterId: 555,
  parameterName: "Load",
  storageType: "Double",
  isReadOnly: false,
  hasValue: true,
  rawValue: "100",
};
const binding = (targets: unknown[] | undefined) => ({
  columnNumber: 2,
  targetElementIds: [7],
  parameterName: "Load",
  parameterId: 555,
  storageType: "Double",
  isEditable: true,
  ...(targets ? { targets } : {}),
});

test("a stored binding without targets refuses; it can never arm a push", () => {
  expect(scheduleCellBindingSchema.safeParse(binding(undefined)).success).toBe(false);
});

test("an unset target's rawValue: null parses", () => {
  const parsed = scheduleCellBindingSchema.parse(
    binding([{ ...target, hasValue: false, rawValue: null }]),
  );
  expect(parsed.targets[0]).toMatchObject({ hasValue: false, rawValue: null });
});

test("a target without the rawValue key refuses", () => {
  const { rawValue: _rawValue, ...absent } = target;
  expect(scheduleCellBindingSchema.safeParse(binding([absent])).success).toBe(false);
});

test("a target without parameterName parses", () => {
  const { parameterName: _parameterName, ...absent } = target;
  expect(scheduleCellBindingSchema.parse(binding([absent])).targets[0]!.parameterId).toBe(555);
});
