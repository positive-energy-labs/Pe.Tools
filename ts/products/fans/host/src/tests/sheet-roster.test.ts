import { expect, test } from "vite-plus/test";
import { ductsDocumentSchema } from "@pe/ducts-contract/system-work";
import { nodeOf, snapshotOf, uniqueIdOf } from "@pe/ducts-domain/test-snapshot";
import { subjectCode, uniqueIdSchema } from "@pe/agent-contracts";
import { fansDocumentSchema } from "@pe/fans-contract/fans";
import { type ReadContext } from "@pe/host-internal/read-graph";
import { evaluate, type InputPort, nativeRead } from "@pe/host-internal/reads/evaluator";
import { closedFan, recordedTables } from "./closed-fan.fixture.ts";
import { fansCalc } from "../host.ts";

test("All prices 112 ports inside the evaluator budget without reading a worksheet", async () => {
  const target = { session: "test", openId: "document" };
  const walks = new Map(
    Array.from({ length: 112 }, (_, i) => {
      const id = 100 * (i + 1);
      return [id, closedFan(id)] as const;
    }),
  );
  const first = walks.get(100)!;
  const roster = {
    ...first,
    nodes: [...walks.values()].flatMap(({ nodes }) => nodes),
    segments: [],
  };
  const tables = recordedTables();
  const terminalDrops = Object.fromEntries(
    [...walks.values()].flatMap(({ nodes }) =>
      nodes
        .filter((node) => node.kind === "terminal")
        .map((node) => [
          subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse(node.uniqueId) }),
          { edit: { value: { inWg: 0.1 }, by: "human" } },
        ]),
    ),
  );
  const port: InputPort = {
    evaluation: "fan-overview-112",
    origin: { kind: "fixture" },
    revision: () => 0,
    async take(name, args) {
      switch (name) {
        case "work-scope":
          return { binding: "open", route: "duct-systems", target: null, open: target };
        case "work":
          return args && typeof args === "object" && "owner" in args && args.owner === "fans"
            ? { doc: { terminalDrops }, revision: 1 }
            : null;
        case "file:firm":
          return { refused: "no-shared-root" };
        case "file:settings":
          return [];
        case "file:catalogs":
          return { tables: {}, findings: [] };
        case "document-mark":
          return { observedSince: 0, changedAt: null, generation: 0 };
        case "native": {
          const call = args as {
            key: string;
            request: { selector?: { kind: string; unitId: number } };
          };
          if (call.key === "ducts.snapshot.roster") return { body: roster, version: "roster" };
          if (call.key === "ducts.tables") return { body: tables, version: "tables" };
          if (call.key === "ducts.snapshot.walk" && call.request.selector?.kind === "from")
            return { body: walks.get(call.request.selector.unitId), version: "walk" };
        }
      }
      throw Error(`Unexpected input: ${name}`);
    },
  };
  const value = await evaluate(fansCalc, { target, fan: "all", calcPath: "" }, port);
  expect(value.data.rows).toHaveLength(112);
  expect(
    value.data.rows.every((row) => row.complete && Number.isFinite(row.requiredEspInWg)),
    JSON.stringify(value.data.rows[0]),
  ).toBe(true);
  expect(value.data.opened).toEqual([]);
  expect(value.trace.length).toBeLessThan(512);
  expect(value.trace.map(({ name }) => name)).not.toContain("fans.calculation");
  expect(value.trace.map(({ name }) => name)).not.toContain("fans.open");
});

test("Fans opens a bounded detail selection and batches its geometry", async () => {
  const target = { session: "test", openId: "document" };
  const rows = Array.from({ length: 8 }, (_, index) => ({
    unitId: index + 1,
    uniqueId: uniqueIdSchema.parse(uniqueIdOf(index + 1)),
    portIndex: 1,
    mark: `FC-${index + 1}`,
    kind: "air-handler",
    side: "supply",
    ratedEspInWg: null,
  }));
  const selected = rows.slice(1);
  const fan = selected.map((row) =>
    subjectCode({ keyKind: "UniqueId", key: row.uniqueId, sub: { port: row.portIndex } }),
  );
  const empty = snapshotOf();
  const snapshot = { ...empty, document: { ...empty.document, readAt: "2026-11-19T00:00:00Z" } };
  const batches: number[][] = [];
  const reads = new Map<string, unknown>([
    ["fans.roster", { target, slots: [], activeSlot: "", rows }],
    [
      "ducts.inputs",
      {
        snapshot,
        version: "roster",
        flow: {
          slotSources: {},
          slots: { terminalFlow: "revit:Flow" },
          coverage: [],
          terminalFlow: { slot: "revit:Flow", ref: "fixture" },
        },
      },
    ],
    [
      "ducts.design-layers",
      {
        ducts: ductsDocumentSchema.parse({}),
        fans: fansDocumentSchema.parse({}),
        revision: 0,
        fansRevision: 0,
        settings: [],
        firm: { refused: "no-shared-root" },
      },
    ],
  ]);
  const unexpected = () => {
    throw Error("Unexpected read-context call");
  };
  const ctx: ReadContext = {
    work: unexpected,
    native: unexpected,
    files: { firm: unexpected, tiers: unexpected },
    compute: (schema, inputs, pure) => schema.parse(pure(inputs)),
    read: async (node, args) => {
      if ("key" in node && node.key === "ducts.snapshot.walk") {
        const { input, output } = nativeRead("ducts.snapshot.walk");
        const { request } = input.parse(args);
        const chooser = request.selector;
        if (chooser?.kind !== "ids" || !chooser.ids) throw Error("Expected geometry by id");
        batches.push(chooser.ids);
        return output.parse({
          body: { ...snapshot, nodes: chooser.ids.map((id) => nodeOf(id, "equipment")) },
          version: `geometry-${batches.length}`,
        });
      }
      const key = "name" in node ? node.name : node.key;
      if (!reads.has(key)) throw Error(`Unexpected read: ${key}`);
      return ("data" in node ? node.data : node.output).parse(reads.get(key));
    },
    collect: async (keys, options) => {
      expect(keys).toEqual(selected);
      expect(options.batch).toBe(1);
      const basis = "walk";
      const paths = { paths: [], rest: 0 };
      return selected.map((row) =>
        options.read.output.parse({
          overview: {
            target,
            basis,
            kind: "overview",
            mode: "fan",
            fan: {
              ...row,
              inletPortIndex: null,
              dischargePortIndex: 1,
              directionMismatch: null,
              flowCfm: null,
            },
            totals: null,
            paths: { supply: paths, return: paths },
            blockers: [],
            assumedBlockers: [],
            next: {
              hint: "",
              legs: [],
              elements: { kind: "elements" },
              inputs: { kind: "inputs" },
              calcBreakdown: { kind: "worksheet" },
            },
          },
          elements: {
            target,
            basis,
            kind: "elements",
            beyond: [],
            walkedElementIds: Array.from(
              { length: 600 },
              (_, index) => row.unitId * 600 + index + rows.length,
            ),
          },
          inputs: null,
          legs: null,
          worstLegs: [],
          calcBreakdown: null,
        }),
      );
    },
  };
  const result = await fansCalc.run(ctx, fansCalc.input.parse({ target, fan }));
  expect(result.opened).toHaveLength(selected.length);
  expect(batches.map((ids) => ids.length)).toEqual([4096, selected.length * 601 - 4096]);
  expect(result.calcSnapshot).toMatchObject({ sourceVersion: "geometry-1+geometry-2" });
  expect("nodes" in result.calcSnapshot && result.calcSnapshot.nodes.map(({ id }) => id)).toEqual(
    batches.flat(),
  );
});
