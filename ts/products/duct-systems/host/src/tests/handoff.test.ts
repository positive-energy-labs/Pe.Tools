import { expect, test } from "vite-plus/test";
import { ductsNetwork, ductsPricing, ductsRoster } from "../host.ts";
import { ductsDocumentSchema } from "@pe/ducts-contract/system-work";
import { fansDocumentSchema } from "@pe/fans-contract/fans";
import { fanSystems } from "@pe/ducts-contract/fan-scope.neutral";
import type { ReadContext } from "@pe/host-internal/read-graph";
import { nativeRead } from "@pe/host-internal/reads/evaluator";
import { snapshot } from "@pe/ducts-domain/test-fixture";

test("pricing reads Chadds' saved ignore with empty pending Work", async () => {
  // The contents of Project Information's _PE_DuctLosses in row2-after-save.json.
  const store = {
    version: 2,
    rules: { "elbow-1d-le10": { table: "CD3-21" } },
    instances: {},
    terminals: {},
    terminalFlows: {},
    equipmentFlows: {},
    verdicts: {
      "open-end:11620957:1": { verdict: "ignore", ruledAt: "2026-11-19T23:38:34.176+00:00" },
    },
    roles: {},
    slots: {
      requiredEsp: "PE_M_Fan_ExternalStaticPressure",
      fanFlow: "PE_M_Fan_AirFlowDesign",
      componentDrop: "Pressure Drop",
      terminalDrop: "PE_M_Grd_ExternalStaticPressure",
      fittingCoefficient: "Pe_C",
      terminalFlow: "revit:Flow",
    },
    workRevision: 1,
    appliedAt: "2026-11-19T23:41:06.995468+00:00",
  };
  const acquired = { ...snapshot, store, sourceVersion: "after-save" };
  const network = {
    ...acquired,
    systemReads: { completed: snapshot.systems.map(({ id }) => id), missing: [] },
  };
  const target = { session: "test", openId: "document" };
  const reads = new Map<string, unknown>([
    ["ducts.roster", { ...acquired, rows: [] }],
    ["ducts.network", network],
    [
      "ducts.design-layers",
      {
        ducts: ductsDocumentSchema.parse({}),
        fans: fansDocumentSchema.parse({}),
        revision: 1,
        fansRevision: 0,
        settings: [],
        firm: { refused: "no-shared-root" },
      },
    ],
    ["file:catalogs", { tables: {}, findings: [] }],
    ["fans.roster", { target, slots: [], activeSlot: "", rows: [] }],
    ["fans.network-calcs", []],
  ]);
  const unexpected = () => {
    throw Error("Unexpected read-context call");
  };
  const ctx: ReadContext = {
    work: unexpected,
    native: unexpected,
    files: { firm: unexpected, tiers: unexpected },
    compute: (schema, inputs, pure) => schema.parse(pure(inputs)),
    collect: unexpected,
    read: async (node) => {
      if ("key" in node && node.key === "ducts.tables")
        return nativeRead("ducts.tables").output.parse({
          body: { folder: "", tables: {}, missing: [], unsupported: {} },
          version: "tables",
        });
      const key = "name" in node ? node.name : node.key;
      if (!reads.has(key)) throw Error(`Unexpected read: ${key}`);
      // Acquisition is supplied by the replay. Production pricing still decodes its entire output.
      return ("data" in node ? node.data : node.output).parse(reads.get(key));
    },
  };
  const value = await ductsPricing.run(ctx, { target, system: "all" });
  expect(value.ductSystemsWork.assumptions).toEqual({});
  expect(value.survey.effective.assumptions).toEqual({
    "open-end:11620957:1": { kind: "verdict", verdict: "ignore" },
  });
});

test("fan scope walks its port even when no roster system names it as base equipment", async () => {
  const fan = { unitId: 17, portIndex: 2 },
    calls: unknown[] = [];
  const roster = {
    ...snapshot,
    rows: [],
    sourceVersion: "roster",
    systems: Array.from({ length: 369 }, (_, id) => ({
      ...snapshot.systems[0]!,
      id,
      name: `SA ${id}`,
      baseEquipmentId: null,
    })),
  };
  const walk = {
    ...snapshot,
    segments: [{ ...snapshot.segments[0]!, systemName: "SA 7", reason: "walked" }],
  };
  const unexpected = () => {
    throw Error("Unexpected read-context call");
  };
  const ctx: ReadContext = {
    work: unexpected,
    native: unexpected,
    files: { firm: unexpected, tiers: unexpected },
    compute: (schema, inputs, pure) => schema.parse(pure(inputs)),
    read: async (read, args) => {
      const isRoster = "name" in read && read.name === ductsRoster.name;
      if (!isRoster) calls.push(args);
      return ("data" in read ? read.data : read.output).parse(
        isRoster ? roster : { body: walk, version: null },
      );
    },
    collect: async (ids, options) => {
      expect(ids).toEqual([7]);
      return [
        options.read.output.parse({
          ...roster,
          systems: roster.systems.filter((s) => s.id === 7),
          sourceVersion: "fan",
          systemReads: { completed: ids, missing: [] },
        }),
      ];
    },
  };
  const target = { session: "test", openId: "document" };
  const network = await ductsNetwork.run(ctx, { target, system: [], fan });
  expect(calls).toEqual([
    {
      role: "acquire",
      target: { kind: "document", ref: target },
      request: { slots: roster.slots, selector: { kind: "from", ...fan } },
    },
  ]);
  expect(network.systems.map((s) => s.name)).toEqual(fanSystems(walk, roster.systems));
});
