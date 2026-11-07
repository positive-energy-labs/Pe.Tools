import { placeInput } from "./typed-place.test-support";
// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { routeVerbJsonSchema } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { KernelServices } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";

import { module as captures } from "../shell/admitted-module.test.fixture";
import { createRouteShell } from "../shell/admitted-mount";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";

// Passing H1 mount reproducer from aba1308d; no migrated route or native model claim.
const input = z.object({
  row: z.string(),
  value: z.union([z.number(), z.string()]),
  kind: z.enum(["part", "slot", "join"]).default("part"),
});
const work = z.object({ drops: z.record(z.string(), z.union([z.number(), z.string()])) });
const declaration = {
  kind: "work" as const,
  input: "drop",
  label: "Part drop",
  review: "none" as const,
  deps: { page: [], work: ["drops"], readings: [] },
  captures: [],
  patches: "drop",
};
async function witness(describe?: (...args: any[]) => unknown) {
  const key = `u8h-${crypto.randomUUID()}`;
  const module = {
    ...captures,
    schemas: { ...captures.schemas, work, drop: input },
    data: {
      ...captures.data,
      key,
      address: "/w1b-history",
      capabilities: ["work"] as const,
      work: { route: key, schema: "work", version: 1, },
      verbs: { drop: { ...declaration, ...(describe && { describe: "describeDrop" }) } },
    },
    bodies: {
      ...captures.bodies,
      ...(describe && {
        describeDrop: {
          slot: "verbs.drop.describe",
          kind: "describe",
          source: { module: "shell/admitted-work-description.test.tsx", export: "witness" },
          run: describe,
        },
      }),
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
const address = { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} };
async function fixture(describe?: (...args: any[]) => unknown) {
  const route = await witness(describe);
  const store = createFixtureWorkDoor(
    { route: route.data.key, title: "", description: "", schema: work },
    { drops: {} },
  );
  const acks: import("@pe/agent-contracts").WorkWriteAck[] = [];
  const door = {
    ...store,
    submitWork: vi.fn<typeof store.submitWork>((scope, write, invocation) => ({
      subscribe(deliver, end) {
        return store.submitWork(scope, write, invocation).subscribe((outcome) => {
          if (outcome.kind === "accepted") acks.push(structuredClone(outcome.ack));
          deliver(outcome);
        }, end);
      },
    })),
  };
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
  const mount = createRouteShell(services).mount(route, placeInput(address));
  await vi.waitFor(() => expect(mount.work()).not.toBeNull());
  return {
    route,
    door,
    services,
    acks,
    mount,
  };
}

for (const [name, describe, reason] of [
  [
    "throw",
    () => {
      throw Error("bad");
    },
    "describe-threw",
  ],
  [
    "mutation",
    (value: any) => {
      value.row = "other";
      return { label: "bad" };
    },
    "describe-threw",
  ],
] as const)
  test(`bad describe ${name} refuses before a write`, async () => {
    const f = await fixture(describe);
    try {
      expect(f.mount.invoke("drop", { row: "DS-1", value: 0.0132 })).toEqual({
        kind: "refused",
        reason,
      });
      expect(f.door.submitWork).not.toHaveBeenCalled();
      expect(f.mount.work()).toMatchObject({ revision: 0, value: { drops: {} } });
      expect(f.mount.journal()!.moves).toEqual([]);
    } finally {
      f.mount.close();
    }
  });

test("description reference is Work-only", () => {
  expect(routeVerbJsonSchema.safeParse({ ...declaration, describe: "describeDrop" }).success).toBe(
    true,
  );
  expect(routeVerbJsonSchema.safeParse({ ...declaration, describe: "" }).success).toBe(false);
  expect(
    routeVerbJsonSchema.safeParse({
      kind: "page",
      input: "drop",
      label: "Page",
      review: "none",
      deps: declaration.deps,
      captures: [],
      fields: [],
      patch: "drop",
      describe: "describeDrop",
    }).success,
  ).toBe(false);
});
