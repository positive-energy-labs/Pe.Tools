import { capabilityCatalogSchema, documentRows } from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture.ts";

import { CHAT_SEEDS } from "#/chat/seeds";
import { liveCatalog, mentionRows } from "./use-mentions";

// What the composer's menu reads: the seed catalog with open documents from the seed inventory.
const seedCatalog = capabilityCatalogSchema.parse(CHAT_SEEDS.send.readings.capabilities);
const catalog = liveCatalog(seedCatalog, seedCatalog.machine);

test("open documents come from the live inventory, not the catalog's own rows", () => {
  const stale = {
    ...catalog,
    capabilities: [...documentRows(catalog), ...catalog.capabilities],
  };
  const inventory = seedCatalog.machine;
  const at = "2026-10-12T18:00:00.000Z";
  const live = liveCatalog(stale, { ...inventory, observedAtUtc: at });
  expect(mentionRows(live, "ope")[0]).toMatchObject({ key: "doc:pe.app-26/open-1" });
  expect(live.at).toBe(at);
  // The document closed: its row goes, though the catalog read at mount still carries it.
  const closed = liveCatalog(stale, { ...inventory, revit: { ...inventory.revit, sessions: [] } });
  expect(mentionRows(closed, "ope").map((row) => row.kind)).not.toContain("document");
  expect(
    mentionRows(
      liveCatalog(stale, { ...inventory, revit: { ...inventory.revit, sessions: null } }),
      "ope",
    ).map((row) => row.kind),
  ).not.toContain("document");
});

test("live mentions use the same bounded discovery projection as Pea", () => {
  const machine = machineFixture([{ session: "s1", documents: null }]);
  Object.assign(machine.revit.sessions![0]!, {
    holdings: [
      {
        openId: "o1",
        title: "Fixture",
        holdings: {
          elements: Array.from({ length: 53139 }, (_, id) => ({
            id,
            category: "fixture",
            name: "HELD_SENTINEL",
            changedSinceSync: null,
            requesters: [],
          })),
          empty: false,
          savedNotSynced: null,
          unsaved: false,
          worksets: [],
          workshared: true,
        },
      },
    ],
  });
  const projected = liveCatalog(seedCatalog, machine);
  expect(JSON.stringify(projected).includes("HELD_SENTINEL")).toBe(false);
  expect(JSON.stringify(projected.machine).length).toBeLessThan(65536);
  expect(projected.machine.revit.sessions![0]!.holdings![0]!.holdings.elementCount).toBe(53139);
});
