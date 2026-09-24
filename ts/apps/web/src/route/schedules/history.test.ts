import { expect, test } from "vite-plus/test";
import {
  applyPatches,
  scheduleGridDocumentSchema,
  scheduleGridRouteState,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { advanceScheduleHistory, scheduleHistoryStep, type ScheduleHistory } from "./history";

test("one schedule batch undoes its cell and basis paths without replacing the document", () => {
  const before = scheduleGridDocumentSchema.parse({});
  const patches: RouteStatePatch[] = [
    { path: ["basis"], value: { captureId: "a".repeat(64) } },
    { path: ["takenAt"], value: "today" },
    { path: ["cells", "1::1", "staged"], value: { value: "Titus" } },
    { path: ["cells", "2::1", "staged"], value: { value: "Titus" } },
  ];
  const step = scheduleHistoryStep(before, patches)!;
  expect(step.after.cells["1::1"]?.staged?.value).toBe("Titus");
  expect(step.after.cells["2::1"]?.staged?.value).toBe("Titus");
  expect(step.inverse.map((patch) => patch.path)).toEqual([
    ["basis"],
    ["takenAt"],
    ["cells", "1::1"],
    ["cells", "2::1"],
  ]);
  const restored = applyPatches(
    scheduleGridRouteState,
    { version: 1, revision: 1, doc: step.after },
    "human",
    step.inverse,
    1,
  );
  expect(restored.ok).toBe(true);
  if (restored.ok) expect(restored.envelope.doc).toEqual(before);
});

test("only the expected own revision promotes history; an external revision invalidates it", () => {
  const before = scheduleGridDocumentSchema.parse({});
  const step = scheduleHistoryStep(before, [
    { path: ["cells", "1::1", "staged"], value: { value: "Titus" } },
  ])!;
  const history: ScheduleHistory = {
    scope: "schedule",
    revision: 3,
    undo: [],
    redo: [],
    pending: [step],
    replay: null,
  };
  expect(advanceScheduleHistory(history, step.after, 5)).toBe(false);
  expect(history.undo).toHaveLength(0);
  expect(advanceScheduleHistory(history, step.after, 4)).toBe(true);
  expect(history.undo).toHaveLength(1);
  expect(advanceScheduleHistory(history, step.after, 5)).toBe(false);
  const fresh: ScheduleHistory = { ...history, revision: null, undo: [], pending: [step] };
  expect(advanceScheduleHistory(fresh, step.after, 1)).toBe(true);
  expect(fresh.undo).toHaveLength(1);
});
