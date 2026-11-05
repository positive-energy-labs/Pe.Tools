import { test, expect, vi } from "vite-plus/test";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { RevitBridge, type BridgeSessionView } from "../src/bridge.ts";
import { detachedBridge } from "./effect-test.ts";
import { opsCatalogRoute } from "../src/ops-catalog.ts";
import { isTsOnlyOperationKey, tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { createCapabilityCatalogSource } from "@pe/mcps";
import { machineFixture } from "../../../packages/agent-contracts/tests/machine-fixture.ts";

test("missing or ambiguous bridge keeps generated discovery metadata and reports availability separately", async () => {
  const sdk = vi.fn(async () => {
    throw new Error("SDK discovery should not run without a bridge attachment");
  });
  const invoke = vi.fn(() => Effect.die("native catalog should not run"));
  let attachments: BridgeSessionView[] = [];
  const bridge = detachedBridge({
    list: Effect.sync(() => attachments),
    invoke,
  });
  const web = HttpRouter.toWebHandler(
    opsCatalogRoute(() => Effect.die("not navigation"), sdk).pipe(
      Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
    ),
    { disableLogger: true },
  );
  try {
    const response = await web.handler(new Request("http://host/ops"), Context.empty() as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      operations: [
        ...hostOpCatalog.filter((op) => !isTsOnlyOperationKey(op.key)),
        ...tsOnlyOperationCatalog,
      ],
      bridgeCatalogError: "No Revit session is connected to the bridge.",
    });
    expect(sdk).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    // Discovery retains schemas, explicit effects and shared product capabilities without a bridge.
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return url.pathname === "/ops"
        ? web.handler(new Request(url), Context.empty() as never)
        : Response.json({ result: { recents: [] } });
    });
    const source = createCapabilityCatalogSource({
      hostBaseUrl: "http://host",
      registrations: [],
      machine: async () => machineFixture(),
    });
    const catalog = await source.read();
    expect(catalog.bridgeSessionId).toBeUndefined();
    expect(catalog.sources.catalog).toContain("bridge catalog unavailable");
    expect(
      catalog.capabilities.find((op) => op.key === "op:revit.catalog.loaded-families"),
    ).toMatchObject({
      needs: "document",
      effect: "query",
      mutates: false,
      input: { type: "object" },
    });
    expect(catalog.capabilities.find((op) => op.key === "op:families.plan")).toMatchObject({
      effect: "query",
      mutates: false,
      principal: expect.arrayContaining(["human", "pea"]),
    });
    expect(catalog.capabilities.filter((op) => op.key === "op:families.plan")).toHaveLength(1);
    for (const op of tsOnlyOperationCatalog)
      expect(body.operations.filter((row: { key: string }) => row.key === op.key)).toEqual([op]);

    // A nonempty attachment inventory enters SDK resolution. Its ambiguity is not catalog absence.
    attachments = [{ connected: true, sessionId: "one" }, { connected: true, sessionId: "two" }];
    sdk.mockRejectedValueOnce(Error("Several Revit sessions match; select one."));
    source.invalidate();
    const ambiguous = await source.read();
    expect(ambiguous.sources.catalog).toContain("Several Revit sessions match");
    expect(ambiguous.capabilities).toEqual(catalog.capabilities);
    expect(ambiguous.bridgeSessionId).toBeUndefined();
    expect(sdk).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    await web.dispose();
  }
});
