import { describe, expect, it } from "vite-plus/test";

import { csv } from "./takeoffs";

describe("takeoffs route search", () => {
  it("keeps a scalar view name with a comma as one value", () => {
    const view = "Mechanical Zoning Plan - Main Level, Controls";

    expect(csv(view)).toEqual([view]);
  });
});
