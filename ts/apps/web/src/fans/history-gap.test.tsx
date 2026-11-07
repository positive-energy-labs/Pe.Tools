import { placeInput } from "../shell/typed-place.test-support";
import { acceptedWork } from "../shell/work-publication.test-support";
// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { bindWork } from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { routeVerbJsonSchema } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { KernelServices } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { module as captures } from "../shell/admitted-module.test.fixture";
import { createRouteShell } from "../shell/admitted-mount";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";

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
      work: { route: "w1b-history", schema: "work", version: 1, migrations: {} },
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
function settle(observation: Observation<WorkWriteOutcome>): Promise<WorkWriteOutcome> {
  return new Promise((resolve) =>
    observation.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve(value);
      },
      () => {},
    ),
  );
}

test("drive-7 S8a labels cannot retain the edited row and value at the admitted mount", async () => {
  const route = await witness();
  const door = createFixtureWorkDoor(
    { route: route.data.key, title: "", description: "", schema: work },
    { drops: {} },
  );
  const services: KernelServices = {
    reads: {
      lifetime: "read",
      acquire: (request) => ({
        lifetime: "read",
        key: request.key,
        read: () => ({ status: "pending", current: false, reason: "unused" }),
        release() {},
      }),
    },
    readings: { lifetime: "subscription", subscribe: () => () => {} },
    clock: { lifetime: "read", now: Date.now },
    availability: {},
    work: door,
  };
  const mount = createRouteShell(services).mount(
    route,
    placeInput({
      read: () => new URLSearchParams(),
      write() {},
      subscribe: () => () => {},
    }),
  );
  try {
    await acceptedWork(mount);
    expect(
      await settle(
        mount.invoke("drop", { row: "DS-1", value: 0.0132 }) as Observation<WorkWriteOutcome>,
      ),
    ).toMatchObject({ kind: "accepted" });
    expect(
      await settle(
        mount.invoke("drop", { row: "SH-1", value: 0.18 }) as Observation<WorkWriteOutcome>,
      ),
    ).toMatchObject({ kind: "accepted" });
    expect(mount.work()?.value).toEqual({ drops: { "DS-1": 0.0132, "SH-1": 0.18 } });
    const labels = mount.journal()!.moves.map((move) => move.label);
    expect(labels).toEqual(["Part drop", "Part drop"]);
    expect(labels).not.toEqual(["Part drop DS-1 → 0.0132 in-wg", "Part drop SH-1 → 0.18 in-wg"]);
  } finally {
    mount.close();
  }
});

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
