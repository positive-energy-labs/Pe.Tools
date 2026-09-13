import { describe, expect, it } from "vite-plus/test";

import { takeoffsWorkingCopyPath } from "./takeoffs";

describe("takeoffs document scope", () => {
  it("uses one stable durable working-copy path", () => {
    expect(takeoffsWorkingCopyPath("C:\\Models\\projectA.rvt")).toBe(
      "C:\\Models\\projectA.PeTakeoffs.rvt",
    );
    expect(takeoffsWorkingCopyPath("C:\\Models\\projectA.PeTakeoffs.rvt")).toBe(
      "C:\\Models\\projectA.PeTakeoffs.rvt",
    );
  });
});
