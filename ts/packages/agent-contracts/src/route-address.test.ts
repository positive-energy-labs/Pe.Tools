import { describe, expect, test } from "vite-plus/test";
import {
  emptyListSearch,
  pickListPill,
  listSearchCodec,
  listSearchRefusal,
} from "./list-search.ts";
import { threadSearchDefault } from "./routes/shared.ts";
import type { OrbitViewport } from "./page-keys.ts";
import { routeAddress, routeAt, routeOf } from "./route-address.ts";

describe("a layers field", () => {
  test("opens on its declared set, and the address stays bare there", () => {
    const ducts = routeAddress("ducts");
    expect(ducts.defaults.layers).toEqual(["meshes", "no-run", "labels", "findings"]);
    expect(ducts.write({ layers: ["meshes", "no-run", "labels", "findings"] })).toEqual({
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
      "no-run",
      "labels",
      "findings",
    ]);
  });
});

describe("the route address", () => {
  test("the thread sidebar query and sort round-trip on Pea and a docked route", () => {
    for (const key of ["pea", "ducts"] as const) {
      const at = routeAddress(key);
      const query = pickListPill(
        { ...emptyListSearch(), keywords: '"supply air"' },
        "scope",
        "attention",
      );
      const link = at.link({ threadSearch: query, threadSort: "recent" });
      const params = Object.fromEntries(new URL(link, "https://pe.test").searchParams);
      expect(at.read(params).page).toMatchObject({ threadSearch: query, threadSort: "recent" });
      expect(at.write({ threadSearch: threadSearchDefault(), threadSort: "" })).toMatchObject({
        threadSearch: undefined,
        threadSort: undefined,
      });
      expect(at.write({ threadSearch: emptyListSearch() }).threadSearch).toBe(
        JSON.stringify(emptyListSearch()),
      );
      expect(at.read({ threadSort: "invalid" }).page.threadSort).toBe("");
    }
    const ducts = routeAddress("ducts");
    expect(
      ducts.agent.patch.safeParse({
        threadSearch: JSON.stringify(pickListPill(emptyListSearch(), "scope", "archived")),
        threadSort: "title",
      }).success,
    ).toBe(true);
  });

  test("a custom route resolver accepts shared sidebar keys and still validates the route patch", () => {
    const ducts = routeAddress("ducts");
    const facts = { systems: [{ name: "SA 19" }, { name: "RA 12" }] };
    const resolve = ducts.agent.resolve!;
    expect(
      resolve(
        {
          threadSearch: JSON.stringify(pickListPill(emptyListSearch(), "scope", "archived")),
          threadSort: "title",
        },
        facts,
      ),
    ).toEqual({
      ok: true,
      patch: {
        threadSearch: JSON.stringify(pickListPill(emptyListSearch(), "scope", "archived")),
        threadSort: "title",
      },
    });
    const mixed = resolve(
      {
        threadSearch: JSON.stringify(pickListPill(emptyListSearch(), "scope", "attention")),
        system: "sa 19",
      },
      facts,
    );
    expect(mixed).toEqual({
      ok: true,
      patch: {
        threadSearch: JSON.stringify(pickListPill(emptyListSearch(), "scope", "attention")),
        system: "SA 19",
      },
    });
    if (mixed.ok) {
      expect(ducts.agent.patch.safeParse(mixed.patch).success).toBe(true);
      expect(ducts.agent.settle(ducts.agent.write(ducts.defaults), mixed.patch)).toEqual(mixed);
    }
    expect(resolve({ threadSearch: "x", system: "unknown" }, facts).ok).toBe(false);
    expect(resolve({ threadSearch: "x", bogus: "unknown" }, facts).ok).toBe(false);
    expect(resolve({ threadSort: "invalid", system: "SA 19" }, facts).ok).toBe(false);
    expect(resolve({}, facts).ok).toBe(false);
  });

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

describe("the thin routes adopt the contract", () => {
  test("ducts list queries and sorts round-trip through links and the agent lease", () => {
    const ducts = routeAddress("ducts");
    const patch = {
      systemSearch: pickListPill({ ...emptyListSearch(), keywords: "" }, "status", "priced"),
      systemSort: "loss" as const,
      rulingSearch: pickListPill({ ...emptyListSearch(), keywords: "" }, "kind", "heal"),
      rulingSort: "status" as const,
      treeSearch: { ...emptyListSearch(), keywords: "12345" },
      treeSort: "name" as const,
      inputSearch: { ...emptyListSearch(), keywords: "fan" },
      inputSort: "name" as const,
    };
    const params = Object.fromEntries(new URL(ducts.link(patch), "https://pe.test").searchParams);
    expect(ducts.read(params).page).toMatchObject(patch);
    expect(ducts.agent.patch.safeParse(ducts.write(patch)).success).toBe(true);
    expect(ducts.agent.resolve!(ducts.write(patch), {}).ok).toBe(true);
    expect(ducts.history(ducts.defaults, patch)).toBe("replace");
    expect(ducts.keys).not.toContain("diagnostic");
  });
  test("every navigable key round-trips through its link", () => {
    const captures = routeAddress("captures");
    expect(captures.link({ sha: "ab", open: ["ab", "cd"] })).toBe("/captures?sha=ab&open=ab%2Ccd");
    expect(captures.read({ open: "ab,cd" }).page).toEqual({
      sha: undefined,
      open: ["ab", "cd"],
      threadSearch: threadSearchDefault(),
      threadSort: "",
    });
    const home = routeAddress("home");
    expect(home.link({ query: "duct", folded: ["/ducts"], sort: "name" })).toBe(
      "/?query=duct&folded=%2Fducts&sort=name",
    );
    expect(routeAddress("settings").link({ section: "none" })).toBe("/settings?section=none");
    expect(routeAddress("data-tables").link({ table: "Loads" })).toBe("/data-tables?table=Loads");
    expect(routeAddress("parameter-links").link({ rail: "folded" })).toBe(
      "/parameter-links?rail=folded",
    );
  });

  test("a route that declared a key nothing renders no longer carries it", () => {
    expect(routeAddress("parameter-links").keys).toEqual(["threadSearch", "threadSort", "rail"]);
  });

  test("history: a pick pushes, a typed or receipt move replaces", () => {
    const ops = routeAddress("ops");
    expect(ops.history({ op: "" }, { op: "revit.x" })).toBe("push");
    expect(ops.history({ actionId: "" }, { actionId: "a1" })).toBe("replace");
    const home = routeAddress("home");
    expect(home.history({ query: "" }, { query: "d" })).toBe("replace");
    expect(home.history({ exposure: "All" }, { exposure: "Main" })).toBe("push");
  });

  test("Pea sets what the page shows and nothing the person's press owns", () => {
    expect(routeAddress("duct-loss").agent.keys).toContain("cfm");
    expect(routeAddress("settings").agent.read({ section: "none" })).toEqual({ section: "none" });
    expect(routeAddress("settings").agent.patch.safeParse({ session: "s" }).success).toBe(false);
    expect(routeAddress("data-tables").agent.patch.safeParse({ table: "Loads" }).success).toBe(
      true,
    );
    // Binding is the person's door and Pea does not lease /pea: no lease at all.
    expect(routeAddress("bind").agent).toBeUndefined();
    expect(routeAddress("pea").agent).toBeUndefined();
    expect(routeAddress("parameter-links").agent).toBeUndefined();
    // Ops is the admin door: Pea runs an operation through pe_do, not a second path to it.
    expect(routeAddress("ops").agent).toBeUndefined();
  });
});

test("list search restores refused input visibly, and retires grammar URL keys", () => {
  const at = routeAddress("ducts");
  for (const raw of [
    "broken json",
    "x".repeat(5000),
    JSON.stringify({ ...emptyListSearch(), v: 9 }),
    JSON.stringify(pickListPill(emptyListSearch(), "missing", "x")),
  ]) {
    const restored = at.read({ systemSearch: raw }).page.systemSearch;
    expect(listSearchRefusal(restored, ["airType", "status", "needsFix"])).toBeTruthy();
    expect(listSearchCodec.encode(restored)).toContain(restored.keywords);
  }
  for (const key of ["systemQuery", "rulingQuery", "treeQuery", "inputQuery", "threadQuery"])
    expect(at.keys).not.toContain(key);
  expect(at.write({ systemSearch: emptyListSearch() })).toEqual({ systemSearch: undefined });
});
