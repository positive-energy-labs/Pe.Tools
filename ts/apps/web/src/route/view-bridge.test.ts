import { describe, expect, it } from "vite-plus/test";
import { routeAddress } from "@pe/agent-contracts";
import { ductsGraph, ductsPageSchema } from "#/ducts/graph";
import { graphUrlPage } from "#/shell/mount-page";
import { familiesGraph, familiesPageSchema } from "#/families/graph";
import { familyGraph, familyPageSchema } from "#/family/graph";
import { schedulesGraph, schedulesPageSchema } from "#/schedules/graph";
import { podsGraph } from "#/pods/graph";
import { podsPageSchema } from "#/pods/page";

/** A route's contract fields are its Page's: the URL carries its url keys, Pea's lease its agent keys. */
describe("route addresses match their manifests", () => {
  it("Family projects URL and agent keys from its graph", () => {
    expect(graphUrlPage(familyGraph).keys).toEqual(routeAddress("family").keys);
    const page = familyPageSchema.parse({});
    for (const key of routeAddress("family").agent.keys) expect(key in page).toBe(true);
  });
  it("Families projects URL and agent keys from its graph", () => {
    expect(graphUrlPage(familiesGraph).keys).toEqual(routeAddress("families").keys);
    const page = familiesPageSchema.parse({});
    const { agent, defaults } = routeAddress("families");
    for (const key of agent.keys)
      expect(key in page || (defaults as Record<string, unknown>)[key] === undefined).toBe(true);
  });
  it("Ducts projects URL policy from its graph fields", () => {
    const page = ductsPageSchema.parse({});
    expect(graphUrlPage(ductsGraph).keys).toEqual(routeAddress("ducts").keys);
    expect(Object.keys(page)).toEqual(
      expect.arrayContaining([...routeAddress("ducts").agent.keys]),
    );
  });
  it("Schedules projects URL and agent keys from its graph", () => {
    expect(graphUrlPage(schedulesGraph).keys).toEqual(routeAddress("schedules").keys);
    const page = schedulesPageSchema.parse({});
    const { agent, defaults } = routeAddress("schedules");
    for (const key of agent.keys)
      expect(key in page || (defaults as Record<string, unknown>)[key] === undefined).toBe(true);
  });
  it("Pods projects URL and agent keys from its graph", () => {
    const page = podsPageSchema.parse({});
    const { keys, agent, defaults } = routeAddress("pods");
    // An optional field (absent = its default) parses to no key at all.
    for (const key of [...keys, ...agent.keys])
      expect(key in page || (defaults as Record<string, unknown>)[key] === undefined).toBe(true);
    expect(graphUrlPage(podsGraph).keys).toEqual(keys);
    expect(Object.keys(agent.write(page))).toEqual(agent.keys);
  });

  it("an entity route's deep link reopens its view, and its own write is that link", () => {
    const url = graphUrlPage(schedulesGraph);
    const page = url.read({
      stage: "history",
      workspaceId: "w1",
      query: "Model~Mill",
      sort: "-c2",
      hidden: "c3",
      cell: "3::1",
    });
    expect(page).toMatchObject({
      stage: "history",
      workspaceId: "w1",
      query: "Model~Mill",
      sort: [{ key: "c2", dir: "desc" }],
      hidden: ["c3"],
      cell: "3::1",
    });
    expect(url.write(page)).toMatchObject({ sort: "-c2", hidden: "c3", cell: "3::1" });
    // A typed query is a gesture (the store marks it replace); a stage is a step.
    expect(url.history({ stage: "audit" }, { stage: "history" })).toBe("push");
    expect(url.history({ cell: "" }, { cell: "3::1" })).toBe("replace");
  });

  it("a patch carries no defaults and refuses a bad mode, viewport or a read-only key", () => {
    const { patch } = routeAddress("ducts").agent;
    expect(patch.parse({ viewport: "orbit:45,30,1.25@0,0,0" })).toEqual({
      viewport: "orbit:45,30,1.25@0,0,0",
    });
    expect(patch.safeParse({ picture: "side" }).success).toBe(false);
    expect(patch.safeParse({ viewport: "orbit:1,2" }).success).toBe(false);
    expect(patch.safeParse({ diagnostic: "x" }).success).toBe(false);
    expect(patch.safeParse({}).success).toBe(false);
  });
});
