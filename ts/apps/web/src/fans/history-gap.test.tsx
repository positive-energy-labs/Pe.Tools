// @vitest-environment jsdom
import { bindWork } from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { routeVerbJsonSchema } from "../../../../packages/agent-contracts/src/route-kernel-data";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";

import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import { module as captures } from "../shell/admitted-module.test.fixture";

// W1b kill-condition witness, not the migrated fan surface or a native ESP fixture.
const input = z.object({ row: z.string(), value: z.number() });
const work = z.object({ drops: z.record(z.string(), z.number()) });
const declaration = {
  kind: "work" as const,
  input: "drop",
  label: "Part drop",
  review: "none" as const,
  deps: { page: [], work: ["drops"], readings: [] },
  captures: [],
  patches: "drop",
};
async function witness() {
  const module = {
    ...captures,
    schemas: { ...captures.schemas, work, drop: input },
    data: {
      ...captures.data,
      key: "w1b-history",
      address: "/w1b-history",
      capabilities: ["work"] as const,
      work: { route: "w1b-history", schema: "work", version: 1, },
      verbs: { drop: declaration },
    },
    bodies: {
      ...captures.bodies,
      drop: {
        slot: "verbs.drop.patches",
        kind: "work" as const,
        source: { module: "fans/history-gap.test.tsx", export: "witness" },
        run: (_ctx: unknown, value: z.output<typeof input>) => [
          { path: ["drops", value.row], value: value.value },
        ],
      },
    },
  };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data,
    hostVersion: "w1b-fixture",
    variants: [{ client: "web" as const, entry: "witness.ts" }],
    modules: [{ id: "witness.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    witness: {
      module,
      closure: { envelope, fingerprint },
      catalog: Object.entries(module.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  });
  const result = (await inventory.prepare("witness", fingerprint)).admitUnknown(module);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.route;
}



test("the declaration has no Work history-description body slot", () => {
  const result = routeVerbJsonSchema.safeParse({
    ...declaration,
    history: { describe: "describeDrop" },
  });
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ code: "unrecognized_keys", keys: ["history"] }),
    );
});

test("legacy Work registration cannot authorize an admitted builtin feed", async () => {
  const route = await witness();
  const workspace = new RouteWorkspace({
    registrations: [{ spec: { route: route.data.key, title: "", description: "", schema: work } }],
    store: { getState: async () => undefined, setState: async () => {} },
  });
  const key = bindWork(route.data.key, null, "w1b-history");
  expect(
    await workspace.admitFeed(key, {
      routeKey: route.data.key,
      fingerprint: route.workFingerprint,
    }),
  ).toMatchObject({ kind: "failed", code: "WorkRouteUnregistered" });
  expect(() => workspace.registerAdmitted(route)).toThrow("duplicate route 'w1b-history'");
  const admittedWorkspace = new RouteWorkspace({
    registrations: [],
    store: { getState: async () => undefined, setState: async () => {} },
  });
  const registration = admittedWorkspace.registerAdmitted(route);
  try {
    expect(
      await admittedWorkspace.admitFeed(key, {
        routeKey: route.data.key,
        fingerprint: route.workFingerprint,
      }),
    ).toBeNull();
  } finally {
    registration.close();
  }
});
