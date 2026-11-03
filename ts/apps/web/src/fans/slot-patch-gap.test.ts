import { placeInput } from "../shell/admitted-place.test-fixture";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { ductsDocumentSchema } from "@pe/agent-contracts";
import type { WorkPatch } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { module as captures } from "../captures/kernel";
import { createRouteShell } from "../shell/admitted-mount";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door";

const slot = {
  path: ["parameters", "fanFlow"],
  value: { edit: { value: "PE_M_Fan_AirFlow" } },
} as const;
const typedSlot: WorkPatch<typeof ductsDocumentSchema> = slot;
const drop: WorkPatch<typeof ductsDocumentSchema> = {
  path: ["componentDrops", "14607308"],
  value: { edit: { value: { inWg: 0.0132 } } },
};
const replacement: WorkPatch<typeof ductsDocumentSchema> = {
  path: ["parameters"],
  value: { fanFlow: { edit: { value: "PE_M_Fan_AirFlow" } } },
};

test("drive-7 S0/S8a: finite slot keys are accepted by typed Work patches", () => {
  expect(
    ductsDocumentSchema.parse({ parameters: { fanFlow: slot.value } }).parameters.fanFlow,
  ).toEqual(slot.value);
  expect(typedSlot).toEqual(slot);
  expect(drop.path).toHaveLength(2);
  expect(replacement.path).toHaveLength(1);
});

test("the real admitted mount accepts the typed finite-key slot", async () => {
  const key = `w1d-slots-${crypto.randomUUID()}`;
  const module = {
    ...captures,
    schemas: { ...captures.schemas, work: ductsDocumentSchema, none: z.object({}) },
    data: {
      ...captures.data,
      key,
      address: "/w1d-slots",
      capabilities: ["work"] as const,
      work: { route: key, schema: "work", version: 1, migrations: {} },
      verbs: {
        slot: {
          kind: "work",
          input: "none",
          label: "Slot",
          review: "none",
          deps: { page: [], work: ["parameters"], readings: [] },
          captures: [],
          patches: "slot",
          describe: "describeSlot",
        },
      },
    } as const,
    bodies: {
      ...captures.bodies,
      slot: {
        slot: "verbs.slot.patches",
        kind: "work",
        source: { module: "slot-patch-gap.test.ts", export: "slot" },
        run: (): readonly WorkPatch<typeof ductsDocumentSchema>[] => [typedSlot],
      },
      describeSlot: {
        slot: "verbs.slot.describe",
        kind: "describe",
        source: { module: "slot-patch-gap.test.ts", export: "describe" },
        run: () => "fanFlow → PE_M_Fan_AirFlow",
      },
    },
  };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data,
    hostVersion: "w1d-fixture",
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
  const door = createFixtureWorkDoor(
    { route: key, title: "", description: "", schema: ductsDocumentSchema },
    ductsDocumentSchema.parse({ parameters: { terminalFlow: { edit: { value: "revit:Flow" } } } }),
  );
  const mount = createRouteShell({
    work: door,
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
  }).mount(
    result.route,
    placeInput({
      read: () => new URLSearchParams(),
      write() {},
      subscribe: () => () => {},
    }),
  );
  try {
    const observation = mount.invoke("slot", {}) as Observation<WorkWriteOutcome>;
    const outcome = await new Promise<WorkWriteOutcome>((resolve) =>
      observation.subscribe(
        (value) => {
          if (value.kind !== "pending") resolve(value);
        },
        () => {},
      ),
    );
    expect(outcome.kind).toBe("accepted");
    expect(ductsDocumentSchema.parse(mount.work()?.value).parameters).toMatchObject({
      terminalFlow: { edit: { value: "revit:Flow" } },
      fanFlow: slot.value,
    });
    expect(mount.journal()!.moves.map((move) => move.label)).toEqual([
      "fanFlow → PE_M_Fan_AirFlow",
    ]);
    if (outcome.kind === "accepted")
      expect(outcome.ack.patches.map((patch) => patch.path)).toContainEqual([
        "parameters",
        "fanFlow",
      ]);
  } finally {
    mount.close();
  }
});
