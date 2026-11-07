import { placeInput } from "../shell/typed-place.test-support";
import { acceptedWork } from "../shell/work-publication.test-support";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { ductsDocumentSchema, workHandleSchema, writePreviewSchema } from "@pe/agent-contracts";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import type { KernelServices } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import { module as captures } from "../shell/admitted-module.test.fixture";
import { createRouteShell } from "../shell/admitted-mount";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
import { presentLosses, presentFan } from "../ducts/reviews";
import { snapshot } from "../ducts/test-fixture";

const source = { module: "fans/presentation-gap.test.ts", export: "witness" };
const empty = { page: [], work: [], readings: [] } as const;

async function witness(present: (...args: unknown[]) => unknown, names = () => snapshot) {
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
      names: { slot: "readings.names.derive", kind: "derive", source, run: names },
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

test.each(["current", "stale-before", "stale-after", "throw", "async"] as const)(
  "drive-7 S5a/S9: invocation-captured naming evidence (%s)",
  async (mode) => {
    let names = structuredClone(snapshot);
    const present = vi.fn((...args: unknown[]) => {
      if (mode === "throw") throw Error("broken presenter");
      if (mode === "async") return Promise.resolve("late");
      const evidence = args[1] as { readings: { names: ReadingSnapshot<typeof snapshot> } };
      return presentLosses(args[0], {
        readings: { sheetSnapshot: evidence.readings.names },
      });
    });
    const route = await witness(present, () => names);
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
      expect(mount.read("names")).toMatchObject({
        current: true,
        value: { nodes: snapshot.nodes },
      });
      expect(mount.invoke("apply", {})).toEqual({ kind: "preview" });
      const handle = JSON.parse(descriptors.get("w1c.write.preview")!.key.sortedKeyInput).work;
      const sealed = {
        previewOnly: true,
        derivedRequest: { equipmentFlows: [{ id: 100, cfm: 925, source: "Work" }] },
        seal: {
          caller: { kind: "human", via: "local" },
          requestHash: "sealed",
          work: { handle },
          documentMark: { session: "s", openId: "o", observedSince: null, changedAt: null },
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
              before: "880 cfm",
              after: "925 cfm",
            },
          ],
          counts: { planned: 1, written: 0, refused: 0, unchanged: 0 },
        },
      };
      const changeNames = () => {
        names = structuredClone(snapshot);
        names.nodes[0]!.facts[0]!.text = "Changed equipment";
        mount.refresh("names");
      };
      // Keep the in-flight callback: invalidation correctly releases the live subscription.
      const previewFrame = frames.get("w1c.write.preview")!;
      if (mode === "stale-before") changeNames();
      const deliver = () =>
        previewFrame({
          status: "ready",
          current: true,
          value: sealed,
          hash: "seal",
        });
      if (mode === "throw" || mode === "async") {
        expect(deliver).toThrow(
          expect.objectContaining({
            kind: "refused",
            reason: mode === "throw" ? "present-threw" : "present-invalid",
          }),
        );
        expect(mount.review("apply")).toBeNull();
        expect(mount.reviewRefusal("apply")).toMatchObject({
          kind: "refused",
          reason: mode === "throw" ? "present-threw" : "present-invalid",
        });
      } else {
        deliver();
        if (mode === "stale-before") {
          expect(present).not.toHaveBeenCalled();
          expect(mount.review("apply")).toBeNull();
        } else {
          expect(present).toHaveBeenCalledOnce();
          const evidence = present.mock.calls[0]![1] as {
            page: object;
            work: object;
            readings: { names: ReadingSnapshot<typeof snapshot> };
          };
          expect(present).toHaveBeenCalledExactlyOnceWith(sealed, evidence);
          expect(Object.keys(evidence)).toEqual(["page", "work", "readings"]);
          expect(Object.keys(evidence.readings)).toEqual(["names"]);
          expect(evidence.page).toEqual({});
          expect(evidence.work).toEqual({});
          expect(Object.isFrozen(evidence)).toBe(true);
          expect(Object.isFrozen(evidence.readings.names.value!.nodes[0]!.facts)).toBe(true);
          expect(mount.review("apply")!.rows[0]).toContain("FC-1");
          expect(mount.review("apply")!.sentence).toContain("1 Revit target");
          // Rule 6 production cells: before from the plan's own write, after from the seal; no
          // Work cell holds this value in the evidence, so the author is unknown, never guessed.
          expect(mount.review("apply")!.cells).toEqual([
            expect.objectContaining({ before: "880 cfm", author: "human" }),
          ]);
          expect(mount.review("apply")!.cells[0]!.after).toContain("925 cfm");
          for (const row of mount.review("apply")!.rows) {
            // Write review audits the target by searchable id; unrelated identities still stay out.
            expect(row).toMatch(/FC-1.*\b100\b/);
            expect(row).not.toMatch(/\b900\b|\belement\s+\d+|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i);
          }
          mount.read("names");
          expect(present).toHaveBeenCalledOnce();
          expect(present.mock.calls[0]![1]).toBe(evidence);
          if (mode === "stale-after") {
            changeNames();
            expect(mount.review("apply")).toMatchObject({ stale: true, rows: [], cells: [], sentence: null });
            expect(evidence.readings.names.value!.nodes[0]!.facts[0]!.text).toBe("FC-1");
            expect(present).toHaveBeenCalledOnce();
          }
        }
        if (mode !== "current") {
          expect(mount.reviewRefusal("apply")).toMatchObject({
            kind: "refused",
            reason: "review-stale",
          });
          expect(() => mount.confirm("apply")).toThrow(
            expect.objectContaining({ reason: "review-stale" }),
          );
        }
      }
      expect(submit).not.toHaveBeenCalled();
    } finally {
      mount.close();
    }
  },
);

test("assign-fan review also needs its declared snapshot to name the system and fan", () => {
  const response = { unitId: 100, systemId: snapshot.systems[0]!.id, outcome: "planned" };
  const bare = presentFan(response, { readings: {} });
  const named = presentFan(response, {
    readings: { ducts: { value: snapshot } },
  });
  expect(bare.rows[0]).not.toContain("FC-1");
  expect(named.rows[0]).toContain("FC-1");
});
