import { describe, expect, it, vi } from "vite-plus/test";

import { FAMILIES_PRODUCT, type FamiliesSlot } from "#/families/product";
import type { Feeds } from "#/targeting/model";

const feeds: Feeds<FamiliesSlot> = {
  world: { options: [], state: "ready", lane: "live", stale: false },
  profile: { options: [], state: "ready", lane: "read", stale: false },
  scope: { options: [], state: "ready", lane: "read", stale: false },
  category: { options: [], state: "ready", lane: "read", stale: false },
  family: { options: [], state: "ready", lane: "read", stale: false },
};

describe("FAMILIES_PRODUCT", () => {
  it("declares the ruled terminals and stages", () => {
    const run = vi.fn();
    const product = FAMILIES_PRODUCT(feeds, {
      applyScope: run,
      plan: run,
      apply: run,
      refusePlan: () => null,
      refuseApply: () => null,
    });
    expect(Object.keys(product.slots)).toEqual(["world", "profile", "scope", "category", "family"]);
    expect(
      Object.values(product.slots)
        .filter((link) => link.multi)
        .map((link) => link.key),
    ).toEqual(["category", "family"]);
    expect(product.slots.profile).toMatchObject({ key: "profile", dir: "read", under: null });
    expect(product.stages.map((stage) => stage.key)).toEqual(["scope", "foundry"]);
    expect(product.stages[1]!.verbs[1]!.kind).toBe("commit");
  });
});
