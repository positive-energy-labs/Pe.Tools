import { describe, expect, it, vi } from "vite-plus/test";

import { FAMILY_PRODUCT } from "#/family/product";

const verbs = () => ({ open: { run: vi.fn() }, save: { run: vi.fn() }, capture: { run: vi.fn() }, build: { run: vi.fn() } });

describe("FAMILY_PRODUCT", () => {
  it("declares the ruled terminals, stages, and panes", async () => {
    const joined = verbs();
    const product = FAMILY_PRODUCT(joined);

    expect(product.links.map(({ key, joiner, dir }) => ({ key, joiner, dir }))).toEqual([
      { key: "session", joiner: "editing", dir: "duplex" },
      { key: "profile", joiner: "on", dir: "duplex" },
    ]);
    expect(product.stages.map((stage) => stage.key)).toEqual(["author", "evidence"]);
    expect(product.panes.map((pane) => pane.key)).toEqual([
      "sheet",
      "anatomy",
      "drill",
      "inspector",
    ]);
    await product.stages[0]!.verbs[0]!.run?.();
    expect(joined.open.run).toHaveBeenCalledOnce();
  });

});
