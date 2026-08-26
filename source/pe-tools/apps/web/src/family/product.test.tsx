import { describe, expect, it, vi } from "vite-plus/test";

import { FAMILY_PRODUCT, type FamilySlot } from "#/family/product";
import type { Feeds } from "#/targeting/model";

const feeds: Feeds<FamilySlot> = {
  world: { options: [], state: "ready", lane: "live", stale: false },
  profile: { options: [], state: "ready", lane: "read", stale: false },
};

const verbs = () => ({
  open: { run: vi.fn(), refuse: () => null },
  save: { run: vi.fn(), refuse: () => null },
  capture: { run: vi.fn(), refuse: () => null },
  build: { run: vi.fn(), refuse: () => null },
});

describe("FAMILY_PRODUCT", () => {
  it("declares the ruled terminals, stages, and panes", async () => {
    const joined = verbs();
    const product = FAMILY_PRODUCT(feeds, joined);

    expect(
      Object.values(product.slots).map(({ key, under, joiner, dir }) => ({
        key,
        under,
        joiner,
        dir,
      })),
    ).toEqual([
      { key: "world", under: null, joiner: "in", dir: null },
      { key: "profile", under: "world", joiner: "editing", dir: "duplex" },
    ]);
    expect(product.stages.map((stage) => stage.key)).toEqual(["author", "evidence"]);
    expect(product.panes.map((pane) => pane.key)).toEqual([
      "sheet",
      "anatomy",
      "drill",
      "inspector",
    ]);
    await product.stages[0]!.verbs[0]!.run({ world: null, profile: null }, feeds);
    expect(joined.open.run).toHaveBeenCalledOnce();
  });
});
