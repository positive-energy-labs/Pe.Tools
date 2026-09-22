import { expect, test } from "vite-plus/test";
import {
  editPrototypeWork,
  emptyPrototypeWork,
  type PrototypeTarget,
} from "./prototype-sentence-model";

test("unbound drafting, reviewed exact targets, local saves and frozen receipts", () => {
  const target: PrototypeTarget = {
    id: "session-a/doc/view",
    kind: "revit",
    path: ["Design", "Demo.rvt", "Level 2"],
  };
  let state = editPrototypeWork(emptyPrototypeWork(), { type: "stage", changes: ["Add totals"] });
  expect(state.changes).toHaveLength(1);
  expect(editPrototypeWork(state, { type: "apply" })).toBe(state);
  state = editPrototypeWork(state, { type: "target", target });
  state = editPrototypeWork(state, { type: "review" });
  const other = {
    ...target,
    id: "session-b/doc/view",
    path: ["Coordination", "Demo.rvt", "Level 2"],
  };
  state = editPrototypeWork(state, { type: "target", target: other });
  expect(state.reviewed).toBe(false);
  expect(editPrototypeWork(state, { type: "apply" })).toBe(state);
  state = editPrototypeWork(editPrototypeWork(state, { type: "review" }), { type: "apply" });
  expect(state.receipts[0]?.target.id).toBe(other.id);
  state = editPrototypeWork(state, {
    type: "target",
    target: { id: "local/profile", kind: "file", path: ["Local files", "profile.json"] },
  });
  state = editPrototypeWork(state, { type: "stage", changes: ["Save profile"] });
  state = editPrototypeWork(editPrototypeWork(state, { type: "review" }), { type: "apply" });
  expect(state.receipts.map((r) => r.target.kind)).toEqual(["revit", "file"]);
  expect(state.receipts[0]?.target.path).toEqual(other.path);
});
