import { z } from "zod";
import { expect, test } from "vite-plus/test";
import { contract } from "./handle.ts";
import { cell, familyParameter, homeFile, landings, product, sheetCells } from "./product.ts";

const rows = contract("probe.rows", {
  input: z.object({ level: z.string() }),
  data: z.object({ rows: z.array(z.string()) }),
  uses: [],
});
const number = { kind: "number" } as const;
const command = {
  says: "",
  input: z.object({}),
  needs: "nothing",
  effect: "query",
  dirties: [],
  native: [],
} as const;
const directory = {
  aliases: [],
  exposure: "Main",
  group: "Proof",
  icon: "Wind",
  label: "Tiny",
  listed: false,
  runtimeNeed: "Nothing",
  satellites: [],
  summary: "A one pane route",
  surfaces: { pwa: "full", tray: false, web: "full" },
} as const;
const tiny = product({
  id: "tiny",
  says: "Tiny",
  homes: { flow: familyParameter("flow"), standards: homeFile("tiny", ["firm"]) },
  cells: {
    cfm: cell(number, "subject", { label: "Flow", default: 0 }),
    "criteria.velocity": cell(number, "route"),
    note: cell(number, "name"),
  },
  readings: { rows: { handle: rows, sources: [] } },
  commands: {
    "tiny.write": { ...command, writes: { flow: ["cfm"] } },
    "tiny.save": { ...command, writes: { standards: ["criteria.velocity"] } },
  },
  routes: {
    tiny: {
      name: "Tiny",
      directory,
      fields: {},
      core: ["rows", (page: { level: string }) => ({ level: page.level })],
      reads: { list: "rows" },
      panes: ["list"],
    },
  },
});

test("a cell's sheet placement follows from the home a command lands it in", () => {
  expect(landings(tiny)).toEqual({ cfm: "flow", "criteria.velocity": "standards" });
  const cells = sheetCells(tiny);
  expect(cells.cfm).toMatchObject({
    home: { at: "parameter", parameter: "flow" },
    per: "subject",
    label: "Flow",
    default: 0,
  });
  expect(cells["criteria.velocity"]?.home).toEqual({
    at: "setting",
    owner: "tiny",
    path: ["criteria", "velocity"],
    tiers: ["firm"],
  });
  // No command lands it, so it stays in Work.
  expect(cells.note?.home).toEqual({ at: "local" });
});

test("a route's readings are built from the declared readings, and its key from the record key", () => {
  const route = tiny.routes.tiny;
  expect(route.key).toBe("tiny");
  expect(route.core.key).toBe("probe.rows");
  expect(route.core.args({ level: "L1" })).toEqual({ level: "L1" });
  expect(route.reads.list.args()).toEqual({});
});
