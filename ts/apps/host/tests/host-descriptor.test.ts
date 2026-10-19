import { expect, test } from "vite-plus/test";
import { createPeClient } from "@pe/agent-contracts/pe-api";
import { createPeRoutes } from "../src/pe-routes.ts";

test("a declared client reads feature revisions beside the serving host version", async () => {
  const app = createPeRoutes({
    registrations: [],
    store: { getState: async () => null, setState: async () => {} },
    heads: { observe: () => () => {} },
  });
  const client = createPeClient("http://host", (url, init) => app.fetch(new Request(url, init)));
  expect(await client.call("features.get", {})).toEqual({
    version: "dev",
    features: { peApi: 1, nativeAdapter: 2 },
  });
});
