import { describe, expect, it } from "vite-plus/test";
import { routeAddress } from "@pe/agent-contracts";
import { manifest as ducts } from "#/ducts/manifest";
import { manifest as families } from "#/families/manifest";
import { familyManifest } from "#/family/manifest";
import { schedulesManifest } from "#/route/schedules/manifest";
import { manifest as pods } from "#/routes/pods";
import { urlPage } from "./url";

const ROUTES = [
  ["families", families],
  ["ducts", ducts],
  ["schedules", schedulesManifest()],
  ["family", familyManifest()],
  ["pods", pods],
] as const;

/** A route's contract fields are its Page's: the URL carries its url keys, Pea's lease its agent keys. */
describe("route addresses match their manifests", () => {
  it("every url and agent key is a page field; the url keys are the manifest's", () => {
    for (const [route, manifest] of ROUTES) {
      expect(manifest.address).toBe(route);
      const page = (manifest.page as unknown as { parse: (v: unknown) => object }).parse({});
      const { keys, agent } = routeAddress(route);
      for (const key of [...keys, ...agent.keys]) expect(page).toHaveProperty(key);
      expect(urlPage(manifest as never)!.keys).toEqual(keys);
      expect(Object.keys(agent.write(page))).toEqual(agent.keys);
    }
  });

  it("an entity route's deep link reopens its view, and its own write is that link", () => {
    const url = urlPage(schedulesManifest())!;
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
