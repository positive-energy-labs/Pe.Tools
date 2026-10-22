import { describe, expect, it } from "vite-plus/test";
import { agentKeys, agentPage, routeViewPatchSchema, urlKeys } from "@pe/agent-contracts";
import { manifest as ducts } from "#/ducts/manifest";
import { manifest as families } from "#/families/manifest";
import { urlPage } from "./url";

/** A route's contract fields are its Page's: the URL carries its url keys, Pea's lease its agent keys. */
describe("route addresses match their manifests", () => {
  it("every url and agent key is a page field; the url keys are the manifest's", () => {
    for (const [route, manifest] of [
      ["families", families],
      ["ducts", ducts],
    ] as const) {
      expect(manifest.address).toBe(route);
      const page = (manifest.page as unknown as { parse: (v: unknown) => object }).parse({});
      for (const key of [...urlKeys(route), ...agentKeys(route)]) expect(page).toHaveProperty(key);
      expect(urlPage(manifest as never)!.keys).toEqual(urlKeys(route));
      expect(Object.keys(agentPage(route, page as never))).toEqual(agentKeys(route));
    }
  });

  it("a patch carries no defaults and refuses a bad mode, viewport or a read-only key", () => {
    const patch = routeViewPatchSchema("ducts");
    expect(patch.parse({ viewport: "orbit:45,30,1.25@0,0,0" })).toEqual({
      viewport: "orbit:45,30,1.25@0,0,0",
    });
    expect(patch.safeParse({ picture: "side" }).success).toBe(false);
    expect(patch.safeParse({ viewport: "orbit:1,2" }).success).toBe(false);
    expect(patch.safeParse({ diagnostic: "x" }).success).toBe(false);
    expect(patch.safeParse({}).success).toBe(false);
  });
});
