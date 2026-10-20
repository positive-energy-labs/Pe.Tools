import { describe, expect, it } from "vite-plus/test";
import { routeViews } from "@pe/agent-contracts";
import { manifest as ducts } from "#/ducts/manifest";
import { manifest as families } from "#/families/manifest";

/** Pea may only set Page keys the route really has; a ducts key is also an address key. */
describe("routeViews opt-ins match their route manifests", () => {
  it("names real page fields, and ducts' as url keys", () => {
    for (const [route, manifest] of [
      ["families", families],
      ["ducts", ducts],
    ] as const) {
      const shape = (manifest.page as unknown as { parse: (v: unknown) => object }).parse({});
      for (const key of Object.keys(routeViews[route].set.shape)) expect(shape).toHaveProperty(key);
    }
    for (const key of Object.keys(routeViews.ducts.set.shape))
      expect(ducts.url).toContain(key as never);
  });
});
