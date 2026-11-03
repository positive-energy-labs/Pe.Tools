import { describe, expect, it } from "vite-plus/test";
import { routeAddress } from "@pe/agent-contracts";
import { ductsPageGraph as ductsGraph } from "#/shell/subject.test-support";
import { ductsPageSchema } from "#/ducts/page";
import { graphUrlPage } from "#/shell/mount-page";
import { familyGraph, familyPageSchema } from "#/family/graph";
import { podsGraph } from "#/pods/graph";
import { podsPageSchema } from "#/pods/page";

/** A route's contract fields are its Page's: the URL carries its url keys, Pea's lease its agent keys. */
describe("route addresses match their manifests", () => {
  it("Family projects URL and agent keys from its graph", () => {
    expect(graphUrlPage(familyGraph).keys).toEqual(["family", ...routeAddress("family").keys]);
    const page = familyPageSchema.parse({});
    for (const key of routeAddress("family").agent.keys) expect(key in page).toBe(true);
  });
  it("Ducts projects URL policy from its graph fields", () => {
    const page = ductsPageSchema.parse({});
    expect(graphUrlPage(ductsGraph).keys.toSorted()).toEqual(routeAddress("ducts").keys.toSorted());
    expect(graphUrlPage(ductsGraph).keys).toContain("fan");
    expect(ductsGraph.fields.fan).toMatchObject({ url: "push", agent: "set" });
    expect(Object.keys(page)).toEqual(
      expect.arrayContaining([...routeAddress("ducts").agent.keys]),
    );
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
