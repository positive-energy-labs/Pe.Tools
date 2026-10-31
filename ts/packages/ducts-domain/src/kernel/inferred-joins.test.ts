/**
 * Reading C#'s measured neighbourhood (model health, ducts LEDGER 2026-10-29): the geometry itself
 * is proved in dotnet `DuctHealthTests`. Here: a measured open port is an end-to-end candidate in
 * elements the read holds, a measured tap face lands on a duct, ends of different classifications
 * stay out without an accept ruling, a reject drops a pair, and candidates rank nearest first.
 */
import { expect, it } from "vite-plus/test";

import type { DuctSnapshot } from "../types.ts";
import {
  applyConnectorPairRulings,
  candidatesOf,
  nearOf,
  type Element,
  type Near,
} from "./inferred-joins.ts";

type Segment = DuctSnapshot["segments"][number];
type Connector = Segment["connectors"][number];

const conn = (index: number, point: number[], classification = "SupplyAir"): Connector => ({
  index,
  kind: "end",
  point,
  shape: "round",
  size: '6"ø',
  diameterIn: 6,
  direction: "bidirectional",
  classification,
  connectedTo: null,
});
const duct = (id: number, a: number[], b: number[], classification = "SupplyAir"): Segment => ({
  id,
  kind: "duct",
  curveKind: "line",
  type: "Round Duct",
  shape: "round",
  size: '6"ø',
  diameterIn: 6,
  lengthFt: 10,
  polyline: [a, b],
  classification,
  roughness: { valueFt: 0.0003, provenance: "revit-default" },
  revit: {},
  connectors: [conn(1, a, classification), conn(2, b, classification)],
});
const graph = (...es: Element[]) => new Map<number, Element>(es.map((e) => [e.id, e]));
const port = (elementId: number, connector: number, gapIn: number, autoJoin = false) => ({
  elementId,
  connector,
  gapIn,
  facingDot: -1,
  opposed: true,
  aligned: true,
  autoJoin,
});
const near = (ports: Near["ports"], faces: Near["faces"] = []): Near => ({
  ports,
  faces,
  bodies: [],
});
const from = { k: "1:2", id: 1, index: 2, cls: "SupplyAir" };

it("open-end records index the neighbourhood by connector key", () => {
  const n = near([port(2, 1, 0.4, true)]);
  const issues = [
    { id: "open-end:1:2", kind: "open-end", elementId: 1, connector: 2, note: "", near: n },
    { id: "stub:3", kind: "stub", elementId: 3, note: "" },
  ] as DuctSnapshot["issues"];
  expect(nearOf(issues).get("1:2")).toBe(n);
  expect(nearOf(issues).size).toBe(1);
});

it("a measured vacant port is an end-to-end candidate only in elements the read holds", () => {
  const a = duct(1, [0, 0, 0], [10, 0, 0]);
  const b = duct(2, [10.03, 0, 0], [20, 0, 0]);
  const n = near([port(2, 1, 0.4, true), port(9, 1, 0.5)]);
  expect(candidatesOf(from, n, graph(a, b))).toMatchObject([
    { kind: "end-to-end", toElement: 2, toConnector: 1, pair: ["1:2", "2:1"], autoJoin: true },
  ]);
});

it("a measured tap face lands on the duct body with its station", () => {
  const a = duct(1, [0, 0, 0], [10, 0, 0]);
  const main = duct(5, [0, 5, 0], [10, 5, 0]);
  const tap = {
    kind: "tap",
    elementId: 5,
    connector: null,
    gapIn: 0.3,
    facingDot: null,
    opposed: false,
    atFt: 4,
    point: [4, 5, 0],
  };
  expect(candidatesOf(from, near([], [tap]), graph(a, main))).toMatchObject([
    { kind: "tap", toElement: 5, toConnector: null, pair: ["1:2", "5"], atFt: 4 },
  ]);
});

it("ends of different classifications are crossing: out without an accept; a reject drops a pair", () => {
  const a = duct(1, [0, 0, 0], [10, 0, 0]);
  const b = duct(2, [10.03, 0, 0], [20, 0, 0], "ReturnAir");
  const found = candidatesOf(from, near([port(2, 1, 0.4, true)]), graph(a, b));
  expect(found).toMatchObject([{ kind: "end-to-end", crossing: true }]);
  expect(applyConnectorPairRulings(found, [])).toEqual([]);
  expect(
    applyConnectorPairRulings(found, [{ pair: ["2:1", "1:2"], verdict: "accept" }]),
  ).toMatchObject([{ pair: ["1:2", "2:1"], ruled: true }]);
  const same = candidatesOf(
    from,
    near([port(2, 1, 0.4, true)]),
    graph(a, duct(2, [10, 0, 0], [20, 0, 0])),
  );
  expect(applyConnectorPairRulings(same, [{ pair: ["1:2", "2:1"], verdict: "reject" }])).toEqual(
    [],
  );
  expect(applyConnectorPairRulings(same, [])).toHaveLength(1);
});

it("candidates rank nearest first and an accepted pair moves to the front", () => {
  const a = duct(1, [0, 0, 0], [10, 0, 0]);
  const nearer = duct(2, [10.02, 0, 0], [20, 0, 0]);
  const farther = duct(3, [10.07, 0, 0], [20, 0, 0]);
  const found = candidatesOf(
    from,
    near([port(3, 1, 0.8), port(2, 1, 0.2)]),
    graph(a, nearer, farther),
  );
  expect(found.map((c) => c.toElement)).toEqual([2, 3]);
  expect(
    applyConnectorPairRulings(found, [{ pair: ["1:2", "3:1"], verdict: "accept" }]).map((c) => [
      c.toElement,
      c.ruled ?? false,
    ]),
  ).toEqual([
    [3, true],
    [2, false],
  ]);
});
