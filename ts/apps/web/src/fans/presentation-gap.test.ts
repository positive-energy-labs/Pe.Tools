import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { ductsDocumentSchema, workHandleSchema, writePreviewSchema } from "@pe/agent-contracts";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import type { KernelServices } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import { module as captures } from "../captures/kernel";
import { createRouteShell } from "../shell/admitted-mount";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
import { presentLosses, presentFan } from "../ducts/reviews";
import type { VerbScope } from "../shell/verbs";
import { snapshot } from "../ducts/test-fixture";

const source = { module: "fans/presentation-gap.test.ts", export: "witness" };
const empty = { page: [], work: [], readings: [] } as const;

// TODO: W1 drive-7 S5a/S9 requires named review targets. The generic present slot
// receives no declared reading evidence; do not keep names in a route-owned side channel.
async function witness(present: (...args: unknown[]) => unknown) {
  const key = `w1c-${crypto.randomUUID()}`;
  const module = {
    ...captures,
    schemas: {
      ...captures.schemas,
      work: ductsDocumentSchema,
      none: z.object({}),
      names: z.unknown(),
    },
    data: {
      ...captures.data,
      key,
      address: "/w1c",
      capabilities: ["work", "native-write"] as const,
      work: { route: key, schema: "work", version: 1, migrations: {} },
      readings: {
        ...captures.data.readings,
        names: {
          kind: "derive",
          output: "names",
          derive: "names",
          deps: empty,
          demand: "visible",
          retain: { evidence: "scope", resource: "scope" },
          refresh: "dependencies",
        },
        preview: {
          kind: "use",
          entry: "w1c.write.preview",
          args: "previewArgs",
          deps: empty,
          demand: "explicit",
          retain: { evidence: "scope", resource: "scope" },
          refresh: "explicit",
        },
      },
      verbs: {
        apply: {
          kind: "command",
          entry: "w1c.write",
          intent: "intent",
          input: "none",
          label: "Write to Revit",
          review: "shown",
          present: "present",
          deps: { ...empty, readings: ["names"] },
          captures: ["names"],
        },
      },
      panes: {
        ...captures.data.panes,
        names: {
          label: "Names",
          purpose: "Review evidence",
          draws: ["names"],
          verbs: [],
          body: "namesPane",
        },
      },
      layout: {
        kind: "split",
        id: "main",
        axis: "h",
        size: 50,
        children: [captures.data.layout, { kind: "pane", id: "names" }],
      },
      stages: { main: { word: "Review", panes: ["captures", "names"], verbs: ["apply"] } },
    } as const,
    entries: {
      ...captures.entries,
      "w1c.write": {
        input: z.strictObject({ work: workHandleSchema }),
        output: z.unknown(),
        axes: {
          subject: "Document",
          touches: ["Metadata"],
          effect: "ModelWrite",
          cost: "Cheap",
          cardinality: "One",
        },
      },
      "w1c.write.preview": {
        input: z.strictObject({ work: workHandleSchema }),
        output: writePreviewSchema,
        axes: {
          subject: "Document",
          touches: ["Metadata"],
          effect: "TransactRead",
          rollsBack: true,
          cost: "Cheap",
          cardinality: "One",
        },
      },
    } as const,
    bodies: {
      ...captures.bodies,
      names: { slot: "readings.names.derive", kind: "derive", source, run: () => snapshot },
      namesPane: {
        slot: "panes.names.body",
        kind: "pane",
        source,
        run: (ctx: { readings: { names: ReadingSnapshot<unknown> } }) => ctx.readings.names,
      },
      previewArgs: { slot: "readings.preview.args", kind: "args", source, run: () => null },
      intent: { slot: "verbs.apply.intent", kind: "intent", source, run: () => ({}) },
      present: { slot: "verbs.apply.present", kind: "present", source, run: present },
    },
  };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data,
    hostVersion: "w1c-fixture",
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

test("drive-7 S5a: named evidence is current but absent from the generic sealed-review presenter", async () => {
  const present = vi.fn((...args: unknown[]) =>
    presentLosses(args[0], { readings: {} } as VerbScope),
  );
  const route = await witness(present);
  const frames = new Map<string, (value: ReadingSnapshot<unknown>) => void>();
  const descriptors = new Map<string, { key: { sortedKeyInput: string } }>();
  const work = createFixtureWorkDoor(
    { route: route.data.key, title: "", description: "", schema: ductsDocumentSchema },
    ductsDocumentSchema.parse({}),
  );
  const submit = vi.spyOn(work, "submit");
  const services: KernelServices = {
    work,
    reads: {
      lifetime: "read",
      acquire: (request) => {
        descriptors.set(request.key.op, request);
        return {
          lifetime: "read",
          key: request.key,
          read: () => ({ status: "pending", current: false, reason: "pending" }),
          release() {},
        };
      },
    },
    readings: {
      lifetime: "subscription",
      subscribe: (request, _token, deliver) => {
        frames.set(request.key.op, deliver as (value: ReadingSnapshot<unknown>) => void);
        return () => {
          frames.delete(request.key.op);
        };
      },
    },
    clock: { lifetime: "read", now: Date.now },
    availability: {},
  };
  const mount = createRouteShell(services).mount(route, {
    read: () => new URLSearchParams(),
    write() {},
    subscribe: () => () => {},
  });
  try {
    expect(mount.read("names")).toMatchObject({ current: true, value: { nodes: snapshot.nodes } });
    expect(mount.invoke("apply", {})).toEqual({ kind: "preview" });
    const handle = JSON.parse(descriptors.get("w1c.write.preview")!.key.sortedKeyInput).work;
    const sealed = {
      previewOnly: true,
      derivedRequest: { equipmentFlows: [{ id: 100, cfm: 925, source: "Work" }] },
      seal: {
        requestHash: "sealed",
        work: { handle },
        incarnation: {},
        dependencies: "names-hash",
      },
      takenAt: "2026-11-03T00:00:00Z",
      response: {
        writes: [
          {
            id: 100,
            kind: "equipment-flow",
            outcome: "planned",
            before: "900 cfm",
            after: "925 cfm",
          },
        ],
        counts: { planned: 1, written: 0, refused: 0, unchanged: 0 },
      },
    };
    frames.get("w1c.write.preview")!({
      status: "ready",
      current: true,
      value: sealed,
      hash: "seal",
    });
    expect(present).toHaveBeenCalledExactlyOnceWith(sealed);
    expect(present.mock.calls[0]).toHaveLength(1);
    expect(mount.review("apply")!.rows[0]).toMatch(/^element /);
    expect(mount.review("apply")!.rows[0]).not.toContain("FC-1");
    const named = presentLosses(sealed, {
      readings: { sheetSnapshot: { value: snapshot } },
    } as unknown as VerbScope);
    expect(named.rows[0]).toContain("FC-1");
    expect(named.sentence).toContain("1 Revit target");
    expect(submit).not.toHaveBeenCalled();
  } finally {
    mount.close();
  }
});

test("assign-fan review also needs its declared snapshot to name the system and fan", () => {
  const response = { unitId: 100, systemId: snapshot.systems[0]!.id, outcome: "planned" };
  const bare = presentFan(response, { readings: {} } as VerbScope);
  const named = presentFan(response, {
    readings: { ducts: { value: snapshot } },
  } as unknown as VerbScope);
  expect(bare.rows[0]).not.toContain("FC-1");
  expect(named.rows[0]).toContain("FC-1");
});
