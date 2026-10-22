import { describe, expect, it } from "vite-plus/test";
import type { z } from "zod";

import type { Viewport } from "./page-keys.ts";
import {
  agentKeys,
  agentPage,
  carryKeys,
  historyOf,
  linkTo,
  readAgentPatch,
  readLink,
  routeAddresses,
  routeAddressFields,
  routePageSchema,
  routeViewPatchSchema,
  routeViewRoutes,
  urlKeys,
  writeSearch,
  type RouteKey,
} from "./route-address.ts";

const routes = Object.keys(routeAddresses) as RouteKey[];

describe("route fields", () => {
  it("no route declares a carried key or the shell, and every field has a page", () => {
    for (const route of routes) {
      const keys = Object.keys(routeAddresses[route].fields);
      expect(keys.filter((key) => [...carryKeys, "shell"].includes(key))).toEqual([]);
      for (const key of keys)
        expect(
          () => (routePageSchema(route).shape as Record<string, z.ZodType>)[key]!.parse(undefined),
          `${route}.${key}`,
        ).not.toThrow();
    }
  });

  it("a bare link reads every URL key's default and writes back bare", () => {
    for (const route of routes) {
      const { page } = readLink(route, {});
      expect(Object.keys(page)).toEqual(urlKeys(route));
      expect(Object.values(writeSearch(route, page)).every((value) => value === undefined)).toBe(
        true,
      );
      expect(linkTo(route)).toBe(routeAddresses[route].path);
    }
  });

  it("only routes with an agent block lease a view, and each sets something", () => {
    expect(routeViewRoutes).toEqual(["ducts", "families"]);
    for (const route of routeViewRoutes)
      expect(Object.keys(routeAddressFields(route).shape).length).toBeGreaterThan(0);
  });
});

describe("links", () => {
  it("round-trips a pods deep link with its carry", () => {
    const link = linkTo("pods", { pod: "Mech", path: "specs/ahu.json" }, { thread: "T1" });
    expect(link).toBe("/pods?pod=Mech&path=specs%2Fahu.json&thread=T1");
    const search = Object.fromEntries(new URL(link, "http://x").searchParams);
    expect(readLink("pods", search)).toEqual({
      page: { pod: "Mech", path: "specs/ahu.json", demo: "" },
      carry: { thread: "T1" },
    });
  });

  it("reads router-parsed values: a numeric id, a boolean flag, a target object", () => {
    const ducts = readLink("ducts", { selected: 8081605, target: { kind: "open", openId: "a" } });
    expect(ducts.page.selected).toBe("8081605");
    expect(ducts.carry.target).toBe('{"kind":"open","openId":"a"}');
    expect(readLink("bind", { view: 1 }).page.view).toBe(true);
    expect(readLink("pea", { turn: "x", mode: "chat" }).page).toMatchObject({
      turn: undefined,
      mode: "threads",
    });
  });

  it("a typed viewport rides the link as its codec writes it, and a malformed one falls to the default", () => {
    const viewport: Viewport = { kind: "orbit", yaw: 10, elev: 20, zoom: 2, pivot: [1, 2, 3] };
    const link = linkTo("ducts", { viewport });
    expect(link).toBe("/ducts?viewport=orbit%3A10%2C20%2C2%401%2C2%2C3");
    const search = Object.fromEntries(new URL(link, "http://x").searchParams);
    expect(readLink("ducts", search).page.viewport).toEqual(viewport);
    expect(readLink("ducts", { viewport: "orbit:1,2" }).page.viewport).toEqual(
      routePageSchema("ducts").shape.viewport.parse(undefined),
    );
  });

  it("a draft key rides the address bar but never a link, and the shell is never carried", () => {
    expect(writeSearch("pea", { prompt: "hi", mode: "world" })).toEqual({
      prompt: "hi",
      mode: "world",
    });
    // @ts-expect-error -- `prompt` is a draft, not a shareable key
    expect(() => linkTo("pea", { prompt: "hi" })).toThrow(/pea links carry no 'prompt'/);
    // @ts-expect-error -- the shell is not a carry key
    expect(linkTo("pea", { mode: "world", turn: 3 }, { thread: "T", shell: "tray" })).toBe(
      "/pea?mode=world&turn=3&thread=T",
    );
  });
});

describe("URL-only and agent-only fields are independent", () => {
  it("URL-only: families `demo` links and reads, and Pea neither sees nor sets it", () => {
    expect(linkTo("families", { demo: "apply" })).toBe("/families?demo=apply");
    expect(readLink("families", { demo: "apply" }).page.demo).toBe("apply");
    expect(agentKeys("families")).not.toContain("demo");
    expect(agentPage("families", { demo: "apply", query: "x" })).toEqual({ query: "x" });
    expect(routeViewPatchSchema("families").safeParse({ demo: "apply" }).success).toBe(false);
  });

  it("agent-only: ducts `issue` Pea sets, while no link, address or history entry holds it", () => {
    expect(routeViewPatchSchema("ducts").parse({ issue: "no-root:7" })).toEqual({
      issue: "no-root:7",
    });
    expect(readAgentPatch("ducts", { issue: "no-root:7" })).toEqual({ issue: "no-root:7" });
    expect(urlKeys("ducts")).not.toContain("issue");
    expect(writeSearch("ducts", { issue: "no-root:7", system: "SA 19" })).toEqual({
      system: "SA 19",
    });
    // @ts-expect-error -- `issue` is not a URL key
    expect(() => linkTo("ducts", { issue: "no-root:7" })).toThrow(/ducts links carry no 'issue'/);
    expect(historyOf("ducts", { issue: "" }, { issue: "no-root:7" })).toBeNull();
    expect(historyOf("ducts", { issue: "" }, { issue: "no-root:7" }, "push")).toBeNull();
  });

  it("agent-read: ducts `diagnostic` is in the lease, and a patch of it is refused", () => {
    expect(agentPage("ducts", { diagnostic: "loss" }).diagnostic).toBe("loss");
    expect(routeViewPatchSchema("ducts").safeParse({ diagnostic: "loss" }).success).toBe(false);
  });

  it("Pea writes a typed key as its lease string, and the page reads it typed", () => {
    expect(agentPage("ducts", {}).viewport).toBe("orbit:45,30,1@0,0,0");
    expect(routeViewPatchSchema("ducts").safeParse({ viewport: "orbit:1,2" }).success).toBe(false);
    expect(readAgentPatch("ducts", { viewport: "plane:2,0,0", camera: "plan" })).toEqual({
      viewport: { kind: "plane", scale: 2, tx: 0, ty: 0 },
      camera: "plan",
    });
  });
});

describe("history", () => {
  const orbit = (yaw: number): Viewport => ({
    kind: "orbit",
    yaw,
    elev: 30,
    zoom: 1,
    pivot: [0, 0, 0],
  });

  it("a step pushes, a tweak replaces, a step among tweaks pushes", () => {
    expect(historyOf("ducts", { system: "" }, { system: "SA 19" })).toBe("push");
    expect(historyOf("ducts", { viewport: orbit(45) }, { viewport: orbit(50) })).toBe("replace");
    expect(
      historyOf(
        "ducts",
        { system: "", viewport: orbit(45) },
        { system: "SA 19", viewport: orbit(50) },
      ),
    ).toBe("push");
  });

  it("a transition overrides the field default; an unchanged key makes no entry", () => {
    expect(historyOf("families", { query: "a" }, { query: "ab" }, "replace")).toBe("replace");
    expect(historyOf("ducts", { viewport: orbit(45) }, { viewport: orbit(90) }, "push")).toBe(
      "push",
    );
    expect(historyOf("ducts", { system: "SA 19" }, { system: "SA 19" }, "push")).toBeNull();
  });
});
