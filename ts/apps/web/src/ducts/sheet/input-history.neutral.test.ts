import { elementSubject } from "@pe/ducts-domain/work-subject";
import { expect, test } from "vite-plus/test";
import { writeLabel } from "#/shell/work-writes";
import { editLabel, presentInputHistory } from "./input-history.neutral";

test("staging the write scope is named and marked internal", () => {
  expect(writeLabel([{ path: ["writeIntent", "edit"], value: 1 }], {})).toEqual({ label: "Edit write scope", internal: true });
});

test("a criteria edit is named in words, never by its key", () => {
  expect(editLabel({ criteria: { allowanceInWg: { supply: 0.1 } } } as never, () => null)).toBe(
    "criteria allowance",
  );
});

test("reverting a value keeps Revert in History and its undo description", () => {
  const label = editLabel({ componentDrops: { [elementSubject({ uniqueId: "6d52156a-3876-4d76-b641-341454252f26-00000007" })]: null } }, () => "DS-1");
  expect(label).toBe("Revert part drop DS-1");
  const entries = [
    { id: "revert", press: "revert", label, by: "human", at: 1, state: "undone", detail: "none" },
  ] as const;
  expect(presentInputHistory(entries, null).last).toEqual({
    label: "undid Revert part drop DS-1",
    words: "",
  });
});
