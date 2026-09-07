import { readFileSync } from "node:fs";
import { nativeFixtureFamilies } from "#/families/fixture";
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

it("native fleet rows and projected JSON retain all four direct authored sources", () => {
  const names = ["a-box", "b-grd", "c-bath-shower", "d-bath-shower-refline"];
  expect(nativeFixtureFamilies).toHaveLength(4);
  nativeFixtureFamilies.forEach(({ raw, model, row }, index) => {
    expect(raw).toBe(
      readFileSync(
        new URL(
          `../../../../../Pe.Revit.Tests/Fixtures/FamilyModel/${names[index]}.family.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(row.familyName).toBe(model.family.name);
    expect(row.typeNames).toEqual(Object.keys(model.types));
    expect(row.parameters.map((p) => p.definition.identity.name)).toEqual(
      Object.keys(model.parameters!),
    );
  });
});
