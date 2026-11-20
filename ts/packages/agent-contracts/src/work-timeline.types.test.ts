import { expect, it } from "vite-plus/test";
import {
  workStepRequestSchema,
  type TimelineRow,
  type WorkStepRequest,
  type WorkTimeline,
} from "./work-timeline.ts";

const work = { binding: "host", route: "ducts", target: null } as const;

/** Never executed. tsc fails this file if either refusal starts to compile. */
export function timelineTypeRefusals(): void {
  // @ts-expect-error an edit row names its Work: row identity is `work` plus `revision`.
  const row: TimelineRow = {
    kind: "edit",
    revision: 1,
    by: "human",
    label: "x",
    state: "applied",
    at: 0,
  };
  // @ts-expect-error a step request sends back the step it was shown.
  const request: WorkStepRequest = { direction: "undo", works: [work] };
  const ok: WorkTimeline = {
    rows: [{ kind: "edit", work, revision: 1, by: "pea", label: "x", state: "applied", at: 0 }],
    undo: { work, revision: 1, label: "x" },
    redo: { home: "C:/home/Settings/ducts.json", sha256: "ab", label: "y" },
    refusal: { undo: null, redo: null },
  };
  void [row, request, ok];
}

it("the step door's body needs an expected step", () => {
  expect(workStepRequestSchema.safeParse({ direction: "undo", works: [work] }).success).toBe(false);
  expect(
    workStepRequestSchema.safeParse({
      direction: "undo",
      works: [work],
      expected: { work, revision: 3, label: "Set friction" },
    }).success,
  ).toBe(true);
});
