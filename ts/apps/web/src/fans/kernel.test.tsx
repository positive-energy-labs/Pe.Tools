import { expect, test } from "vite-plus/test";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { module as capturesModule } from "../captures/kernel";
import { ductsDocumentSchema } from "@pe/agent-contracts";
import { fansGraph } from "./graph";

test.each(["ducts", "fans"])(
  "W1 shared Work admission: fans with Work owned by %s",
  async (workRoute) => {
    expect(fansGraph.workRoute).toBe("ducts");
    // Isolate the Work identity law using the reference route's already admitted bodies.
    // This is an admission falsifier, not a translation or migration of either product route.
    const fansModule = {
      ...capturesModule,
      schemas: { ...capturesModule.schemas, work: ductsDocumentSchema },
      data: {
        ...capturesModule.data,
        key: "fans",
        address: "/fans",
        name: "Fans",
        capabilities: ["work"] as const,
        work: { route: workRoute, schema: "work", version: 1, migrations: {} },
      },
    };
    // Test-only source closure. No production receipt or route registration is installed.
    const envelope = {
      source: "builtin-closure" as const,
      version: 1 as const,
      data: fansModule.data,
      hostVersion: "w1-fixture",
      variants: [{ client: "web" as const, entry: "route.js" }],
      modules: [{ id: "route.js", sha256: "a".repeat(64) }],
      inputs: [],
      externals: [],
    };
    const fingerprint = await builtinClosureFingerprint(envelope);
    const inventory = createBuiltinRouteInventory({
      fans: {
        module: fansModule,
        closure: { envelope, fingerprint },
        catalog: Object.entries(fansModule.entries).map(([key, entry]) => ({
          key,
          ...entry.axes,
          uses: [],
        })),
      },
    });
    const result = (await inventory.prepare("fans", fingerprint)).admitUnknown(fansModule);
    if (workRoute === "fans") {
      expect(result.ok).toBe(true);
      return;
    }
    expect(result.ok).toBe(false);
    if (result.ok)
      throw Error("Shared Work is now admitted; replace this blocker with mount proofs");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        path: "work.route",
        reference: "ducts",
        expected: "fans",
        message: "Work belongs to another route",
      }),
    );
  },
);
