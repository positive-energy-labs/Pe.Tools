import { expect, test } from "vite-plus/test";
import type { SubjectKey } from "@pe/kit/lang/attention";
import {
  captureRequest,
  hoverGroupsOf,
  jumpSubject,
  markPick,
  membersWithStrands,
} from "./picture";

test("focus captures walked and near once, sorted; context layers ask context", () => {
  const focus = {
    walked: ["e:3", "e:1"] as SubjectKey[],
    near: ["e:3", "e:9", "issue:x"] as SubjectKey[],
  };
  const request = captureRequest(focus, ["meshes"], 10, "link-boxes")!;
  expect(request.elementIds).toEqual([1, 3, 9]);
  expect(request.focusOnly).toBe(true);
  expect(captureRequest(focus, ["halo"], 10, "link-boxes")!.focusOnly).toBe(false);
  expect(captureRequest({ walked: [], near: [] }, ["context"], 10, "link-boxes")).toBeNull();
});

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
    { key: "run:a", path: ["e:1"] },
    { key: "run:b", path: ["e:2", "e:3"] },
  ]);
  expect(members.get("run:a")).toEqual(["leg:1"]);
  expect(members.get("run:b")).toEqual(["e:2", "e:3"]);
  expect(membersWithStrands(declared, [])).toBe(declared);
});

test("reverse hover lights the smallest admitted group holding the element", () => {
  const members = new Map<SubjectKey, readonly SubjectKey[]>([
    ["run:r", ["leg:a", "leg:b"]],
    ["leg:a", ["e:1", "e:2"]],
    ["leg:b", ["e:3", "e:4", "e:5"]],
    ["issue:i", ["e:1"]],
  ]);
  const groups = hoverGroupsOf(members, (g) => !g.startsWith("issue:"));
  expect(groups.get("e:1")).toEqual(["e:1", "e:2"]);
  expect(groups.get("e:4")).toEqual(["e:3", "e:4", "e:5"]);
  expect(hoverGroupsOf(members, () => true).get("e:1")).toEqual(["e:1"]);
});

test("a jump frames the named element alone, and a run by its element leaves", () => {
  const members = new Map<SubjectKey, readonly SubjectKey[]>([
    ["run:a", ["section:1", "e:30"]],
    ["section:1", ["e:10", "e:20"]],
  ]);
  expect(jumpSubject("e:10", members)).toEqual({ selected: "10", ids: new Set([10]) });
  expect(jumpSubject("run:a", members)).toEqual({ selected: "run:a", ids: new Set([10, 20, 30]) });
  // An undeclared group has no elements to frame: the picture says it is not here.
  expect(jumpSubject("run:gone", members).ids.size).toBe(0);
});
