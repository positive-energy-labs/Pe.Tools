import { expect, test } from "vite-plus/test";
import { ductsNetwork, ductsRoster } from "../host.ts";
import { fanSystems } from "@pe/ducts-contract/fan-scope.neutral";
import type { ReadContext } from "@pe/host/read-graph";
import { snapshot } from "@pe/ducts-web/test-fixture";

test("fan scope walks its port even when no roster system names it as base equipment", async () => {
  const fan = { unitId: 17, portIndex: 2 }, calls: unknown[] = [];
  const roster = { ...snapshot, rows: [], sourceVersion: "roster", systems: Array.from({ length: 369 }, (_, id) => ({ ...snapshot.systems[0]!, id, name: `SA ${id}`, baseEquipmentId: null })) };
  const walk = { ...snapshot, segments: [{ ...snapshot.segments[0]!, systemName: "SA 7", reason: "walked" }] };
  const unexpected = () => { throw Error("Unexpected read-context call"); };
  const ctx: ReadContext = {
    work: unexpected, native: unexpected, files: { firm: unexpected, tiers: unexpected },
    compute: (schema, inputs, pure) => schema.parse(pure(inputs)),
    read: async (read, args) => {
      const isRoster = "name" in read && read.name === ductsRoster.name;
      if (!isRoster) calls.push(args);
      return ("data" in read ? read.data : read.output).parse(isRoster ? roster : { body: walk, version: null });
    },
    collect: async (ids, options) => {
      expect(ids).toEqual([7]); return [options.read.output.parse({ ...roster, systems: roster.systems.filter(s => s.id === 7), sourceVersion: "fan", systemReads: { completed: ids, missing: [] } })];
    },
  };
  const target = { session: "test", openId: "document" };
  const network = await ductsNetwork.run(ctx, { target, system: [], fan });
  expect(calls).toEqual([{ role: "acquire", target: { kind: "document", ref: target }, request: { selector: { kind: "from", ...fan } } }]);
  expect(network.systems.map(s => s.name)).toEqual(fanSystems(walk, roster.systems));
});
