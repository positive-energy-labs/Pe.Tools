import { expect, test } from "vite-plus/test";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { hoverGroupsOf, jumpSubject, markPick, membersWithStrands } from "./picture";
import { eKey, testElements } from "#/test-attention";



test("a strand pick selects its own subject; an issue pick its element and the issue", () => {
  expect(markPick({ key: "run:7", elementId: 1, subject: true })).toEqual({
    selected: "run:7",
    issue: "",
  });
  expect(markPick({ key: "blocker-3", elementId: 42 })).toEqual({
    selected: "42",
    issue: "blocker-3",
  });
});

test("strands declare their paths as members unless the surface already did", () => {
  const declared = new Map<SubjectKey, readonly SubjectKey[]>([["run:a", ["leg:1"]]]);
  const members = membersWithStrands(declared, [
    { key: "run:a", path: [eKey(1)] },
    { key: "run:b", path: [eKey(2), eKey(3)] },
  ]);
  expect(members.get("run:a")).toEqual(["leg:1"]);
  expect(members.get("run:b")).toEqual([eKey(2), eKey(3)]);
  expect(membersWithStrands(declared, [])).toBe(declared);
});

test("reverse hover lights the smallest admitted group holding the element", () => {
  const members = new Map<SubjectKey, readonly SubjectKey[]>([
    ["run:r", ["leg:a", "leg:b"]],
    ["leg:a", [eKey(1), eKey(2)]],
    ["leg:b", [eKey(3), eKey(4), eKey(5)]],
    ["issue:i", [eKey(1)]],
  ]);
  const groups = hoverGroupsOf(members, (g) => !g.startsWith("issue:"));
  expect(groups.get(eKey(1))).toEqual([eKey(1), eKey(2)]);
  expect(groups.get(eKey(4))).toEqual([eKey(3), eKey(4), eKey(5)]);
  expect(hoverGroupsOf(members, () => true).get(eKey(1))).toEqual([eKey(1)]);
});

test("a jump frames the named element alone, and a run by its element leaves", () => {
  const members = new Map<SubjectKey, readonly SubjectKey[]>([
    ["run:a", ["section:1", eKey(30)]],
    ["section:1", [eKey(10), eKey(20)]],
  ]);
  expect(jumpSubject(eKey(10), members, testElements([10, 20, 30]))).toEqual({ selected: "10", ids: new Set([10]) });
  expect(jumpSubject("run:a", members, testElements([10, 20, 30]))).toEqual({ selected: "run:a", ids: new Set([10, 20, 30]) });
  // An undeclared group has no elements to frame: the picture says it is not here.
  expect(jumpSubject("run:gone", members, testElements([10, 20, 30])).ids.size).toBe(0);
});
