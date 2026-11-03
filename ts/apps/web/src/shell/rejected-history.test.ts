import { expect, test } from "vite-plus/test";
import { stepState } from "./situation-band";

test("a rejected Pea write leaves human history not written without calling it rejected", () => {
  const journal = { redo: [] } as never;
  const step = {
    by: "human",
    notWritten: { invocation: "write", reason: "rejected by you", rejected: false },
  };
  expect(stepState(journal, step as never)).toBe("not written");
  expect(
    stepState(journal, {
      ...step,
      by: "pea",
      notWritten: { ...step.notWritten, rejected: true },
    } as never),
  ).toMatch(/not written.*rejected/);
});
