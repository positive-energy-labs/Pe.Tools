import { describe, expect, it } from "vite-plus/test";

import {
  pathOf,
  pickInto,
  prints,
  product,
  progress,
  refusal,
  targets,
  terminals,
  trunks,
  type Feeds,
} from "#/targeting/model";
import { flowSide } from "#/targeting/flow";

const slots = {
  world: {
    key: "world",
    under: null,
    joiner: "in",
    placeholder: "pick a world",
    multi: false,
    needs: "a world",
    dir: null,
    liveness: "attached",
  },
  rvt: {
    key: "rvt",
    under: "world",
    joiner: "",
    placeholder: "no document",
    multi: false,
    needs: "doc",
    dir: null,
    liveness: null,
  },
  view: {
    key: "view",
    under: "rvt",
    joiner: "from",
    placeholder: "pick a plan",
    multi: false,
    needs: "views",
    dir: "read",
    liveness: "detached",
  },
  zones: {
    key: "zones",
    under: "rvt",
    joiner: "into",
    placeholder: "pick zones",
    multi: true,
    needs: "zones",
    dir: "write",
    liveness: "detached",
  },
  folder: {
    key: "folder",
    under: null,
    joiner: "beside",
    placeholder: "pick a folder",
    multi: false,
    needs: "folder",
    dir: null,
    liveness: null,
  },
  r10: {
    key: "r10",
    under: "folder",
    joiner: "syncing",
    placeholder: "pick a .r10",
    multi: false,
    needs: "r10s",
    dir: "sync",
    liveness: "detached",
  },
} as const;

const feeds = {
  world: { options: [{ id: "w1", label: "w1" }], state: "ready", lane: "live", stale: false },
  rvt: { options: [{ id: "d1", label: "d1" }], state: "ready", lane: "live", stale: false },
  view: { options: [{ id: "v1", label: "v1" }], state: "ready", lane: "read", stale: false },
  zones: { options: [{ id: "z1", label: "z1" }], state: "ready", lane: "read", stale: true },
  folder: { options: [], state: "ready", lane: "read", stale: false },
  r10: { options: null, state: "ready", lane: "read", stale: false, seam: { needs: "r10s" } },
} satisfies Feeds<keyof typeof slots>;

const P = product(
  "t",
  "t",
  slots,
)({
  feeds,
  stages: [
    {
      key: "s",
      label: "s",
      verbs: [
        {
          key: "go",
          label: "go",
          demands: ["view", "zones"],
          kind: "act",
          run: async () => {},
          refuse: () => null,
          needs: "views and zones",
        },
        {
          key: "nope",
          label: "nope",
          demands: [],
          kind: "seam",
          run: async () => {
            throw Error("a handler");
          },
          refuse: () => null,
          needs: "a handler",
        },
      ],
    },
  ],
  panes: [],
});

product("bad", "bad", { world: slots.world })({
  feeds: { world: feeds.world },
  stages: [
    {
      key: "bad",
      label: "bad",
      verbs: [
        {
          key: "bad",
          label: "bad",
          // @ts-expect-error a verb cannot demand a key its product does not declare
          demands: ["document"],
          kind: "act",
          run: async () => {},
          refuse: () => null,
          needs: "never",
        },
      ],
    },
  ],
  panes: [],
});

const bound = { world: "w1", rvt: "d1", view: "v1", zones: null, folder: null, r10: null };

describe("targeting manifest", () => {
  it("prints terminals and only leaf trunks", () => {
    expect(targets(P).map((link) => link.key)).toEqual(["view", "zones", "r10"]);
    expect(terminals(P).map((link) => link.key)).toEqual(["view", "zones", "r10"]);
    expect(trunks(P).map((link) => link.key)).toEqual(["world", "rvt", "folder"]);
    expect(
      prints(
        product("instances", "instances", { world: slots.world })({
          feeds: { world: feeds.world },
          stages: [],
          panes: [],
        }),
        "world",
      ),
    ).toBe(true);
    expect(pathOf(P, "zones").map((link) => link.key)).toEqual(["world", "rvt", "zones"]);
  });

  it("puts read terminals left and every output terminal right", () => {
    expect(flowSide("read")).toBe("left");
    expect([flowSide("write"), flowSide("sync"), flowSide("duplex")]).toEqual([
      "right",
      "right",
      "right",
    ]);
  });

  it("re-picking a shared trunk clears every descendant", () => {
    const next = pickInto(P, bound, { zones: new Set(["z1"]) }, P.slots.world, "w2");
    expect(next.bound).toMatchObject({ world: "w2", rvt: null, view: null, zones: null });
    expect(next.multi.zones?.size).toBe(0);
  });

  it("progress names where an incomplete pick stopped", () => {
    const chain = pathOf(P, "view");
    expect(progress(chain, bound, {})).toMatchObject({ complete: true });
    const half = progress(chain, { ...bound, rvt: null, view: null }, {});
    expect(half.deepest?.key).toBe("world");
    expect(half.next?.key).toBe("rvt");
  });

  it("refuses in order: unwired, unbound, stale, route gate", () => {
    const [go, seam] = P.stages[0]!.verbs;
    expect(refusal(P, seam!, bound, {})).toMatch(/not wired/);
    expect(refusal(P, go!, bound, { zones: new Set() })).toMatch(/needs zones bound/);
    expect(refusal(P, go!, bound, { zones: new Set(["z1"]) })).toMatch(/zones is stale/);
    const fresh = { ...P, feeds: { ...P.feeds, zones: { ...P.feeds.zones, stale: false } } };
    expect(refusal(fresh, go!, bound, { zones: new Set(["z1"]) })).toBeNull();
    expect(
      refusal(fresh, { ...go!, refuse: () => "capture first" }, bound, { zones: new Set(["z1"]) }),
    ).toBe("capture first");
  });
});
