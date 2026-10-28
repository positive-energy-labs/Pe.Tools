import { expect, test } from "vite-plus/test";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { captureRequest, hoverGroupsOf } from "./picture";

test("focus captures walked and near once, sorted; context layers ask context", () => {
  const focus = { walked: ["e:3", "e:1"] as SubjectKey[], near: ["e:3", "e:9", "issue:x"] as SubjectKey[] };
  const request = captureRequest(focus, ["meshes"], 10, "boxes")!;
  expect(request.elementIds).toEqual([1, 3, 9]);
  expect(request.focusOnly).toBe(true);
  expect(captureRequest(focus, ["halo"], 10, "boxes")!.focusOnly).toBe(false);
  expect(captureRequest({ walked: [], near: [] }, ["context"], 10, "boxes")).toBeNull();
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
