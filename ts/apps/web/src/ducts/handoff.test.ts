import { expect, test } from "vite-plus/test";
import { ductsNetwork, ductsRoster } from "./host";
import { fanSystems } from "./identity";
import { snapshot } from "./test-fixture";

test("fan scope walks its port even when no roster system names it as base equipment", async () => {
  const fan = { unitId: 17, portIndex: 2 }, calls: unknown[] = [];
  const roster = { ...snapshot, systems: Array.from({ length: 369 }, (_, id) => ({ ...snapshot.systems[0]!, id, name: `SA ${id}`, baseEquipmentId: null })) };
  const walk = { segments: [{ systemName: "SA 7", reason: "walked" }] };
  const ctx = {
    read: async (read: unknown, args: unknown) => {
      if (read === ductsRoster) return roster;
      calls.push(args); return { body: walk };
    },
    collect: async (ids: number[]) => {
      expect(ids).toEqual([7]); return [{ ...roster, systems: roster.systems.filter(s => s.id === 7), sourceVersion: "fan", systemReads: { completed: ids, missing: [] } }];
    },
  } as unknown as Parameters<typeof ductsNetwork.run>[0];
  const network = await ductsNetwork.run(ctx, { target: {} as never, system: [], fan });
  expect(calls).toEqual([{ role: "acquire", target: { kind: "document", ref: {} }, request: { selector: { kind: "from", ...fan } } }]);
  expect(network.systems.map(s => s.name)).toEqual(fanSystems(walk, roster.systems));
});
