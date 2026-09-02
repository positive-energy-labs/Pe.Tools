import { afterEach, expect, test, vi } from "vite-plus/test";

import { fetchPeInfo } from "./info";

afterEach(() => vi.unstubAllGlobals());

test("keeps Revit capability separate from bridge attachment", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        controllerId: "pea",
        resourceId: "local",
        bridgeIsConnected: false,
        capabilities: { revit: true },
        world: {
          id: "local",
          root: "C:/repo",
          storage: { kind: "local-unversioned" },
          isolation: "none",
        },
      }),
    ),
  );

  await expect(fetchPeInfo({ origin: "http://localhost" })).resolves.toMatchObject({
    capabilities: { revit: true },
    bridgeIsConnected: false,
  });
});
