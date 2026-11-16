import { expect, test } from "vite-plus/test";
import { fansDocumentSchema, subjectCode } from "@pe/agent-contracts";
import { parameter, sheetSlotData } from "@pe/agent-contracts/slots";
import { validateSheetValues } from "../src/slots/sheet.ts";

// FANS-HOLD-CFM-SOURCE: the Work schema admits `{ cfm, source }`, so the sheet value check must too.
const number = { kind: "number", min: 0 } as const;
const sheet = sheetSlotData({ draft: true, bindings: {
  equipmentFlows: parameter("fanFlow", { kind: "object", fields: { cfm: number }, text: ["source"] }),
  esp: parameter("fanStatic", { kind: "object", fields: { inWg: number } }),
} });
const unit = subjectCode({ keyKind: "UniqueId", key: "3f2c9a10-0000-4000-8000-000000000001-0001e240" });

test("a sourced cfm cell passes the sheet value check; an undeclared key is still refused", () => {
  const value = { cfm: 900, source: "balancing report" };
  expect(fansDocumentSchema.parse({ equipmentFlows: { [unit]: { edit: { value } } } }).equipmentFlows[unit]!.edit!.value).toEqual(value);
  expect(() => validateSheetValues(sheet, { equipmentFlows: { [unit]: { edit: { value } } } })).not.toThrow();
  expect(() => validateSheetValues(sheet, { equipmentFlows: { [unit]: { edit: { value: { cfm: 900 } } } } })).not.toThrow();
  expect(() => validateSheetValues(sheet, { equipmentFlows: { [unit]: { edit: { value: { cfm: 900, source: 7 } } } } })).toThrow();
  expect(() => validateSheetValues(sheet, { esp: { [unit]: { edit: { value: { inWg: 1, source: "x" } } } } })).toThrow(/Unrecognized key/);
});
