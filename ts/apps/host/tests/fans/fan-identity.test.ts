import { testDuctFiles, settle } from "../effect-test.ts";
import { expect, test } from "vite-plus/test";
import { fanRoster } from "../../../../products/fans/host/src/fan-calc.ts";
import { evaluate } from "@pe/host-internal/reads/evaluator";
import { calcPort } from "../ducts/ducts-read.fixture.ts";
import { RouteWorkspace } from "@pe/runtime";
import { subjectCode, uniqueIdSchema } from "@pe/agent-contracts/subject-ref";
import { bindWork } from "@pe/agent-contracts";
import {
  ductsRosterResponseSchema,
  type ductsRosterRequestSchema,
} from "@pe/fans-contract/calc-read";
import type { z } from "zod";
import { snapshot } from "@pe/ducts-domain/test-fixture";

test("roster composition retains UniqueId for two equipment instances with the same mark", async () => {
  const fan = snapshot.nodes.find((node) => node.id === 100)!;
  const nodes = [
    { ...fan, family: "Fan Coil", uniqueId: "fixture-fan-alpha" },
    { ...fan, id: 101, family: "Fan Coil", uniqueId: "fixture-fan-beta" },
  ];
  const target = { session: "fixture", openId: "doc" };
  const workspace = new RouteWorkspace({ registrations: [], store: { getState: async () => null, setState: async () => {} } });
  const roster = (await evaluate(fanRoster, { target }, calcPort({
    firm: (owner) => settle(testDuctFiles().firm(owner)), catalogs: () => settle(testDuctFiles().catalogsFor(undefined)),
    workKey: async () => bindWork("duct-systems", null, undefined, target),
    call: async () => Response.json({ ...snapshot, nodes }),
  }, workspace))).data;
  expect(roster.rows).toHaveLength(2);
  expect(roster.rows.map((row) => row.mark)).toEqual(["FC-1", "FC-1"]);
  expect(new Set(roster.rows.map((row) => subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse(row.uniqueId), sub: { port: row.portIndex } }))).size).toBe(2);
  expect(roster.rows.map((row) => row.uniqueId)).toEqual(["fixture-fan-alpha", "fixture-fan-beta"]);
});

test("a numeric UniqueId row is refused without hiding the other fan rows", async () => {
  const fan = snapshot.nodes.find(node => node.id === 100)!;
  const target = { session: "fixture", openId: "doc" };
  const nodes = [
    { ...fan, family: "Fan Coil", uniqueId: "fixture-fan-good" },
    { ...fan, id: 101, family: "Fan Coil", uniqueId: "101" },
  ];
  const workspace = new RouteWorkspace({ registrations: [], store: { getState: async () => null, setState: async () => {} } });
  const roster = (await evaluate(fanRoster, { target }, calcPort({
    firm: (owner) => settle(testDuctFiles().firm(owner)), catalogs: () => settle(testDuctFiles().catalogsFor(undefined)),
    workKey: async () => bindWork("duct-systems", null, undefined, target),
    call: async () => Response.json({ ...snapshot, nodes }),
  }, workspace))).data;
  expect(roster.rows.map(row => row.uniqueId)).toEqual(["fixture-fan-good"]);
  expect(ductsRosterResponseSchema.shape.rows.element.safeParse({ ...roster.rows[0], uniqueId: "101" }).success).toBe(false);
});

test("a lookup by mark returns only the rows carrying that mark, and no mark returns every row", async () => {
  const fan = snapshot.nodes.find((node) => node.id === 100)!;
  const nodes = [
    { ...fan, family: "Fan Coil", uniqueId: "fixture-fan-fc" },
    { ...fan, id: 101, family: "Fan Coil", uniqueId: "fixture-fan-ma", facts: fan.facts.map((fact) => ({ ...fact, text: "MA-1" })) },
  ];
  const target = { session: "fixture", openId: "doc" };
  const read = async (args: z.input<typeof ductsRosterRequestSchema>) => {
    const workspace = new RouteWorkspace({ registrations: [], store: { getState: async () => null, setState: async () => {} } });
    return (await evaluate(fanRoster, args, calcPort({
      firm: (owner) => settle(testDuctFiles().firm(owner)), catalogs: () => settle(testDuctFiles().catalogsFor(undefined)),
      workKey: async () => bindWork("duct-systems", null, undefined, target),
      call: async () => Response.json({ ...snapshot, nodes }),
    }, workspace))).data;
  };
  const found = await read({ target, mark: " ma-1 " });
  expect(found.rows.map((row) => [row.mark, row.uniqueId])).toEqual([["MA-1", "fixture-fan-ma"]]);
  expect((await read({ target, mark: "MA-9" })).rows).toEqual([]);
  expect((await read({ target })).rows.map((row) => row.mark)).toEqual(["FC-1", "MA-1"]);
});
