import { expect, it } from "vite-plus/test";
import { ductsRouteState } from "@pe/agent-contracts";
import { catalogSchema, catalogLoss, catalogLinkKey, type CatalogTable } from "./catalog.ts";
import { computeLosses } from "./losses.ts";
import { price, applyRequest, stagedFanout } from "./pricing.ts";
import { friction, sectionOf } from "./loss-physics.ts";
import fixture from "./fixtures/catalogs/price-lbp/catalog.json" with { type: "json" };
import synthetic from "../../../apps/web/src/ducts/fixtures/synthetic-snapshot.json" with { type: "json" };
import type { DuctSnapshot } from "./types.ts";

const table = catalogSchema.parse(fixture).tables[0]!;
const catalogs = { [table.id]: table };
const sample = synthetic as unknown as DuctSnapshot;
function terminal(width = 12, height = 4) {
  const node = structuredClone(sample.nodes.find((n) => n.id === 30)!);
  node.connectors = [
    { ...node.connectors[0]!, shape: "rectangular", widthIn: width, heightIn: height },
  ];
  node.facts.push({
    key: "Pe_Catalog",
    text: table.id,
    value: null,
    unit: "",
    provenance: "designer-stated",
  });
  return node;
}

it("inverts every published 15A flow cell to its static-pressure column, cited to footer 8", () => {
  table.rows.values.forEach((width, i) =>
    table.cells.values[i]!.forEach((flow, j) => {
      const result = catalogLoss(terminal(24, width), flow * 2, catalogs);
      expect(result.dp).not.toBeNull();
      if (result.dp === null) throw Error(result.error);
      expect(result.staticInWg).toBeCloseTo(table.columns.values[j]!, 12);
      expect(result.source).toMatchObject({
        file: "lbp.pdf",
        page: 8,
        pdfPage: 1,
        edition: "v100",
      });
    }),
  );
});

it("interpolates width then inverts flow inside that interpolated row", () => {
  // At 4.5 in: flow at .044 = (98+125)/2, flow at .069 = (122+157)/2.
  const result = catalogLoss(terminal(16, 4.5), ((111.5 + 139.5) / 2) * (16 / 12), catalogs);
  expect(result.dp).not.toBeNull();
  if (result.dp !== null) expect(result.staticInWg).toBeCloseTo((0.044 + 0.069) / 2, 12);
});

it.each([
  [4, 48],
  [4, 221],
  [1, 100],
  [6.01, 100],
])("refuses width %s and flow %s outside the table without a number", (height, cfm) => {
  expect(catalogLoss(terminal(12, height), cfm, catalogs)).toMatchObject({
    dp: null,
    finding: "catalog-out-of-range",
  });
});

it("makes a missing link and an unloaded linked table separate findings, ignoring native assigned static", () => {
  const node = terminal();
  node.facts = node.facts.filter((f) => f.key !== "Pe_Catalog");
  expect(catalogLoss(node, 98, catalogs)).toMatchObject({
    dp: null,
    finding: "catalog-missing-link",
  });
  expect(catalogLoss(terminal(), 98, {})).toMatchObject({
    dp: null,
    finding: "catalog-missing-table",
  });
  node.facts.push({
    key: "Pe_Catalog",
    text: "constructor",
    value: null,
    unit: "",
    provenance: "designer-stated",
  });
  expect(catalogLoss(node, 98, {})).toMatchObject({ dp: null, finding: "catalog-missing-table" });
});

it("applies note 4's .8 to return STATIC, then adds connector velocity pressure per note 7", () => {
  const node = terminal();
  node.classification = "Return Air";
  const result = catalogLoss(node, 98, catalogs);
  const pv = friction(sectionOf("rectangular", null, 12, 4)!, 98, 0).pv;
  expect(result.dp).toBeCloseTo(0.044 * 0.8 + pv, 12);
  if (result.dp !== null) {
    expect(result.staticInWg).toBeCloseTo(0.0352, 12);
    expect(result.pv).toBeCloseTo(pv, 12);
  }
  expect(result.notes.join(" ")).toContain("connector");
  expect(result.notes.join(" ")).toContain("p. 11");
});

it("uses data-only direct total-pressure, Pa conversion and coefficient tables", () => {
  const direct = (
    quantity: CatalogTable["result"]["quantity"],
    unit: CatalogTable["result"]["unit"],
    value: number,
  ) =>
    catalogSchema.parse({
      version: 1,
      tables: [
        {
          ...table,
          columns: { quantity: "flow", unit: "cfm", values: [0, 200], input: { field: "flowCfm" } },
          cells: { quantity, unit, values: table.rows.values.map(() => [value, value * 3]) },
          result: {
            ...table.result,
            from: "cells",
            quantity,
            unit,
            toInWg: unit === "Pa" ? 1 / 249.08891 : 1,
          },
        },
      ],
    }).tables[0]!;
  const total = direct("total-pressure", "Pa", 10);
  expect(catalogLoss(terminal(), 100, { [table.id]: total }).dp).toBeCloseTo(20 / 249.08891, 12);
  const coefficient = direct("coefficient", "1", 0.5);
  const pv = friction(sectionOf("rectangular", null, 12, 4)!, 100, 0).pv;
  expect(catalogLoss(terminal(), 100, { [table.id]: coefficient }).dp).toBeCloseTo(pv, 12);
});

it("refuses malformed and nonmonotonic grids and ambiguous connectors", () => {
  expect(() =>
    catalogSchema.parse({
      version: 1,
      tables: [{ ...table, cells: { ...table.cells, values: [[1, 1]] } }],
    }),
  ).toThrow();
  const node = terminal();
  node.connectors.push(node.connectors[0]!);
  expect(catalogLoss(node, 98, catalogs)).toMatchObject({ dp: null, finding: "catalog-input" });
});

it("stages a family/type link through Work, reprices changed catalog inputs, and retains missing rows as null", () => {
  const snap = structuredClone(sample);
  snap.nodes = snap.nodes.map((n) => (n.id === 30 ? terminal() : n));
  const node = snap.nodes.find((n) => n.id === 30)!;
  node.facts = node.facts.filter((f) => f.key !== "Pe_Catalog");
  const key = catalogLinkKey(node.family, node.type);
  const doc = ductsRouteState.schema.parse({
    catalogs: { [key]: { staged: { value: { table: table.id } } } },
    flows: { "30": { staged: { value: { cfm: 98 } } } },
  });
  const priced = price(snap, {}, doc, catalogs);
  expect(priced.now.paths[30]!.rows.at(-1)).toMatchObject({
    dp: null,
    finding: "catalog-missing-link",
  });
  expect(priced.next.paths[30]!.rows.at(-1)).toMatchObject({ table: table.id, staticInWg: 0.044 });
  const other = { [table.id]: { ...table, result: { ...table.result, toInWg: 2 } } };
  expect(price(snap, {}, doc, other).next.paths[30]!.total).toBeGreaterThan(
    priced.next.paths[30]!.total,
  );
  const proposed = ductsRouteState.schema.parse({
    catalogs: { [key]: { proposal: { value: { table: table.id } } } },
  });
  expect(price(snap, {}, proposed, catalogs).next.paths[30]!.rows.at(-1)?.dp).toBeNull();
  expect(computeLosses(snap, {}).paths[30]!.rows.at(-1)?.dp).toBeNull();
  const request = applyRequest(snap, priced, "2026-10-16T00:00:00Z", "");
  expect(request.terminals.find((t) => t.id === 30)).toMatchObject({
    inWg: priced.next.paths[30]!.rows.at(-1)!.dp,
  });
});

it("keeps native catalog pressure when a fitting table fanout is priced", () => {
  const snap = structuredClone(sample);
  const node = terminal();
  node.facts.find((f) => f.key === "flow")!.value = 98;
  snap.nodes = snap.nodes.map((n) => (n.id === node.id ? node : n));
  const doc = ductsRouteState.schema.parse({
    rules: {
      "elbow-1d-gt10": { staged: { value: { table: "CD3-21" } } },
    },
  });
  const priced = price(snap, {}, doc, catalogs);
  const changed = stagedFanout(snap, {}, priced, "elbow-1d-gt10")!;
  expect(changed.after.paths[node.id]!.rows.at(-1)).toMatchObject({
    table: table.id,
    staticInWg: 0.044,
  });
  expect(changed.after.paths[node.id]!.rows.at(-1)?.dp).toBe(
    changed.before.paths[node.id]!.rows.at(-1)?.dp,
  );
});
