import { describe, expect, it, vi } from "vite-plus/test";

import { FAMILIES_PRODUCT } from "#/families/product";

describe("FAMILIES_PRODUCT", () => {
  it("declares the ruled terminals and stages", () => {
    const run = vi.fn();
    const product = FAMILIES_PRODUCT({ applyScope: run, plan: run, apply: run });
    expect(product.links.map((link) => link.key)).toEqual([
      "world",
      "profile",
      "scope",
      "category",
      "family",
    ]);
    expect(product.links.filter((link) => link.multi).map((link) => link.key)).toEqual([
      "category",
      "family",
    ]);
    expect(product.stages.map((stage) => stage.key)).toEqual(["scope", "foundry"]);
    expect(product.stages[1]!.verbs[1]!.commit).toBe(true);
  });
});
