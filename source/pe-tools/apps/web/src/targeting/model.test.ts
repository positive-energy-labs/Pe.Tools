import { describe, expect, it } from "vite-plus/test";

import {
  pathOf,
  pickInto,
  progress,
  refusal,
  seams,
  terminals,
  type Feeds,
  type Product,
} from "#/targeting/model";

const P: Product = {
  key: "t",
  name: "t",
  links: [
    { key: "world", joiner: "in", placeholder: "pick a world", needs: "a world" },
    { key: "rvt", parent: "world", joiner: "", placeholder: "no document", needs: "doc" },
    {
      key: "view",
      parent: "rvt",
      joiner: "from",
      placeholder: "pick a plan",
      needs: "views",
      dir: "read",
    },
    {
      key: "zones",
      parent: "rvt",
      joiner: "into",
      placeholder: "pick zones",
      needs: "zones",
      dir: "write",
      multi: true,
    },
    { key: "folder", joiner: "beside", placeholder: "pick a folder", needs: "folder" },
    {
      key: "r10",
      parent: "folder",
      joiner: "syncing",
      placeholder: "pick a .r10",
      needs: "r10s",
      dir: "sync",
    },
  ],
  stages: [
    {
      key: "s",
      label: "s",
      verbs: [
        { key: "go", label: "go", demands: ["view", "zones"], run: async () => {} },
        { key: "nope", label: "nope", demands: [], run: null, needs: "a handler" },
      ],
    },
  ],
  panes: [],
};

const feeds: Feeds = {
  world: { options: [{ id: "w1", label: "w1" }], state: "ready", lane: "live", stale: false },
  rvt: { options: [{ id: "d1", label: "d1" }], state: "ready", lane: "live", stale: false },
  view: { options: [{ id: "v1", label: "v1" }], state: "ready", lane: "read", stale: false },
  zones: { options: [{ id: "z1", label: "z1" }], state: "ready", lane: "read", stale: true },
  folder: { options: [], state: "ready", lane: "read", stale: false },
  r10: {
    options: null,
    state: "ready",
    lane: "read",
    stale: false,
    seam: { needs: "r10s" },
  },
};

describe("targeting manifest", () => {
  it("terminals are the sentence; trunks (world, rvt, folder) never print", () => {
    expect(terminals(P).map((l) => l.key)).toEqual(["view", "zones", "r10"]);
    expect(pathOf(P, "zones").map((l) => l.key)).toEqual(["world", "rvt", "zones"]);
  });

  it("re-picking a shared trunk clears every descendant, single and multi", () => {
    const bound = { world: "w1", rvt: "d1", view: "v1", folder: null, r10: null };
    const multi = { zones: new Set(["z1"]) };
    const next = pickInto(P, bound, multi, P.links[0]!, "w2");
    expect(next.bound).toMatchObject({ world: "w2", rvt: null, view: null });
    expect(next.multi.zones?.size).toBe(0);
  });

  it("progress names where an incomplete pick stopped", () => {
    const chain = pathOf(P, "view");
    expect(progress(chain, { world: "w1", rvt: "d1", view: "v1" }, {})).toMatchObject({
      complete: true,
    });
    const half = progress(chain, { world: "w1", rvt: null, view: null }, {});
    expect(half.complete).toBe(false);
    expect(half.deepest?.key).toBe("world");
    expect(half.next?.key).toBe("rvt");
    expect(progress(chain, {}, {}).deepest).toBeNull();
  });

  it("derives seams: an unsourced link and an unwired verb, nothing flagged by hand", () => {
    expect(seams(P, feeds).map((s) => `${s.kind}:${s.subject}`)).toEqual([
      "options:r10",
      "verb:s/nope",
    ]);
  });

  it("refuses in order: unwired → unbound demand → stale demand → the verb's own gate", () => {
    const bound = { world: "w1", rvt: "d1", view: "v1", folder: null, r10: null };
    const go = P.stages[0]!.verbs[0]!;
    expect(refusal(P, P.stages[0]!.verbs[1]!, bound, {}, feeds)).toMatch(/not wired/);
    expect(refusal(P, go, bound, { zones: new Set() }, feeds)).toMatch(/needs zones bound/);
    expect(refusal(P, go, bound, { zones: new Set(["z1"]) }, feeds)).toMatch(/zones is stale/);
    const freshFeeds = { ...feeds, zones: { ...feeds.zones!, stale: false } };
    expect(refusal(P, go, bound, { zones: new Set(["z1"]) }, freshFeeds)).toBeNull();
    expect(
      refusal(
        P,
        { ...go, refuse: () => "capture first" },
        bound,
        { zones: new Set(["z1"]) },
        freshFeeds,
      ),
    ).toBe("capture first");
  });
});
