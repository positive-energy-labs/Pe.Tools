import { describe, expect, test } from "vite-plus/test";
import type { OrbitViewport } from "./page-keys.ts";
import { routeAddress, routeAt, routeOf } from "./route-address.ts";

describe("a layers field", () => {
  test("opens on its declared set, and the address stays bare there", () => {
    const ducts = routeAddress("ducts");
    expect(ducts.defaults.layers).toEqual(["meshes", "labels", "findings"]);
    expect(ducts.write({ layers: ["meshes", "labels", "findings"] })).toEqual({
      layers: undefined,
    });
    expect(routeAddress("space").link({ layers: ["meshes", "context", "cuts"] })).toBe("/space");
  });

  test("every layer off is none, and reads back as none", () => {
    expect(routeAddress("ducts").link({ layers: [] })).toBe("/ducts?layers=");
    expect(routeAddress("ducts").read({ layers: "" }).page.layers).toEqual([]);
    expect(routeAddress("rooms").read({ layers: "faces,rails" }).page.layers).toEqual([
      "faces",
      "rails",
    ]);
  });

  test("an unknown layer name falls to the default", () => {
    expect(routeAddress("ducts").read({ layers: "none" }).page.layers).toEqual([
      "meshes",
      "labels",
      "findings",
    ]);
  });
});

describe("the route address", () => {
  test("is one object per route, found by key or path", () => {
    expect(routeAddress("pea")).toBe(routeAddress("pea"));
    expect(routeOf("ducts")).toBe("ducts");
    expect(routeOf("nowhere")).toBeNull();
    expect(routeAt("/duct-loss")).toBe("duct-loss");
  });

  test("a route known only as a key is any route's address, still typed", () => {
    const key = routeOf("ducts")!;
    const at = routeAddress(key);
    const { page } = at.read({ system: "SA" });
    // The union of every route's page narrows by its keys; a page of no route is refused.
    expect("system" in page ? page.system.toUpperCase() : null).toBe("SA");
    expect(at.link(page)).toBe("/ducts?system=SA");
    // @ts-expect-error no route links a `bogus` key
    expect(() => at.link({ bogus: true })).toThrow("ducts links carry no 'bogus'");
    // A union that mixes leasing and non-leasing routes may hold no lease.
    // @ts-expect-error possibly undefined
    expect(at.agent.keys).toContain("system");
  });

  test("a link drops defaults and drafts and keeps the carry", () => {
    const pea = routeAddress("pea");
    const { page, carry } = pea.read({ turn: "3", prompt: "draft", thread: "t1" });
    expect(carry).toEqual({ thread: "t1" });
    expect(pea.link(page, carry)).toBe("/pea?turn=3&thread=t1");
    expect(pea.write(page)).toMatchObject({ prompt: "draft" });
  });

  test("a tab link is canonical and refuses what it cannot read", () => {
    const space = routeAddress("space");
    expect(space.tab("/space?mode=top&shell=tray&target=x")).toEqual({
      ok: true,
      link: "/space?mode=top&target=x",
    });
    expect(space.tab("/space?mode=side").ok).toBe(false);
    expect(space.tab("/ducts").ok).toBe(false);
    // The mode's rule between fields: an orbit viewport is no pose for an axis.
    expect(space.tab("/space?mode=top&viewport=orbit:1,2,3@0,0,0").ok).toBe(false);
  });

  test("a transition resets an unnamed key its rule breaks and refuses a named one", () => {
    const space = routeAddress("space");
    const orbit: OrbitViewport = { kind: "orbit", yaw: 0, elev: 0, zoom: 1, pivot: [0, 0, 0] };
    const current = { ...space.defaults, viewport: orbit };
    expect(space.transition(current, { mode: "top" })).toMatchObject({
      ok: true,
      patch: { mode: "top", viewport: null },
    });
    expect(space.transition(current, { mode: "top", viewport: orbit }).ok).toBe(false);
  });

  test("history pushes a step, replaces a tweak, and makes no entry for no URL change", () => {
    const loss = routeAddress("duct-loss");
    expect(loss.history({ cfm: 1000 }, { cfm: 1200 })).toBe("replace");
    expect(loss.history({ shape: "round" }, { shape: "rect" })).toBe("push");
    expect(loss.history({ cfm: 1000 }, { cfm: 1000 })).toBeNull();
  });

  test("Pea's lease writes, reads and settles its keys as strings", () => {
    const space = routeAddress("space");
    const agent = space.agent;
    expect(agent.patch.safeParse({ scene: "x" }).success).toBe(false);
    const lease = agent.write(space.defaults);
    expect(lease.mode).toBe("3d");
    expect(agent.read({ mode: "top" })).toEqual({ mode: "top" });
    expect(agent.settle({ ...lease, viewport: "orbit:0,0,1@0,0,0" }, { mode: "top" })).toEqual({
      ok: true,
      patch: { mode: "top", viewport: "" },
    });
  });
});
