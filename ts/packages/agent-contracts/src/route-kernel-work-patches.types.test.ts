import { expect, test } from "vite-plus/test";
import type { WorkPatch } from "./route-kernel-bodies.ts";

type Work = {
  cells: Record<string, { edit?: { value: string }; count: number }>;
  title: string;
};
const patches: readonly WorkPatch<Work>[] = [
  { path: ["title"], value: "Schedule" },
  { path: ["cells", "1::1"], value: { count: 1 } },
  { path: ["cells", "1::1", "edit"], value: { value: "reviewed" } },
  { path: ["cells", "1::1", "count"], value: 2 },
  { path: ["cells", "1::1"], op: "delete" },
];
// @ts-expect-error A leaf keeps its value type.
const wrongValue: WorkPatch<Work> = { path: ["cells", "1::1", "count"], value: "two" };
// @ts-expect-error Unknown entry fields are refused.
const wrongLeaf: WorkPatch<Work> = { path: ["cells", "1::1", "missing"], value: 1 };
// @ts-expect-error Unknown top-level fields are refused.
const wrongRoot: WorkPatch<Work> = { path: ["missing", "1::1"], op: "delete" };
// @ts-expect-error Scalar top-level fields have no keyed patch door.
const scalar: WorkPatch<Work> = { path: ["title", "length"], op: "delete" };
// @ts-expect-error Deletion cannot also replace a value.
const deleteValue: WorkPatch<Work> = { path: ["cells", "1::1"], op: "delete", value: { count: 1 } };

test("keyed Work patch signatures keep path and value correlated", () => {
  expect(patches).toHaveLength(5);
  void [wrongValue, wrongLeaf, wrongRoot, scalar, deleteValue];
});
