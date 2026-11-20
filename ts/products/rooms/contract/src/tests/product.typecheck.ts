// Compiled by this package's `check`, never run: every `@ts-expect-error` is a declaration `tsc` must refuse.
import { z } from "zod";
import {
  cell,
  documentRecord,
  familyParameter,
  product as define,
  sheetCells,
} from "@pe/agent-contracts/product";
import { product, roomsWork } from "../product.ts";

type Editable = (typeof roomsWork.editable)[number];
const staged: Editable = ["ceilingFt", "*"];
// @ts-expect-error a cell Pea may edit that the Work schema lacks
const drifted: Editable = ["esp", "*"];
const doc = roomsWork.schema.parse({});
const marks: Record<string, unknown> = doc.marks;
// @ts-expect-error the Work schema has no such cell either
const absent: unknown = doc.esp;

const base = { ...product, routes: {} };
const write = product.commands["rooms.write"];
define({ ...base, commands: { "rooms.write": { ...write, writes: { regions: ["name"] } } } });
// @ts-expect-error a command whose writes names a cell the product lacks
define({ ...base, commands: { "rooms.write": { ...write, writes: { regions: ["esp"] } } } });
// @ts-expect-error a command whose writes names a home the product lacks
define({ ...base, commands: { "rooms.write": { ...write, writes: { carriers: [] } } } });
// @ts-expect-error a machine file holds no cell
define({ ...base, commands: { "rooms.write": { ...write, writes: { traces: ["name"] } } } });
// @ts-expect-error a reading whose source is no home of the product
define({ ...base, readings: { plans: { ...product.readings.plans, sources: ["carriers"] } } });

// M1: a route reads only a declared reading, by its name.
const route = { name: "R", directory: product.routes.rooms.directory, fields: {}, panes: ["a"] };
const routed = define({ ...base, routes: { r: { ...route, core: "plans" } } });
const key: "r" = routed.routes.r.key;
// @ts-expect-error a route that reads what the product does not declare
define({ ...base, routes: { r: { ...route, core: "stray" } } });
// @ts-expect-error a route's reads, by pane, are held to the same list
define({ ...base, routes: { r: { ...route, reads: { a: ["stray", () => ({})] } } } });

// M2: a cell carries a value domain, and the sheet's placement follows from the home it lands in.
const placed = sheetCells(product).name?.home;
// @ts-expect-error a cell with a bare schema and no value domain
cell(z.string(), "subject");

// M3: only the constructors and the generated handle make a home.
const carrier = familyParameter("room.name");
const homes = { ...product.homes, carrier };
const { kind, key: homeKey, takes, cost, place } = carrier;
const copied = { kind, key: homeKey, takes, cost, place };
// @ts-expect-error a home written by hand
define({ ...base, homes: { ...product.homes, copied } });
// @ts-expect-error a C# home restated as a literal
documentRecord({ key: "owner-blob:11111111-2222-3333-4444-555555555555" });
const byHand = { domain: product.cells.people.domain, per: "route" } as const;
// @ts-expect-error a cell written by hand
define({ ...base, cells: { ...product.cells, byHand } });

// M4: a cell lands in at most one home across every command.
const one = { ...write, writes: { regions: ["name"] } } as const;
define({ ...base, homes, commands: { "rooms.write": one } });
define({
  ...base,
  homes,
  // @ts-expect-error one command that lands a cell in two homes
  commands: { "rooms.write": { ...write, writes: { regions: ["name"], carrier: ["name"] } } },
});
define({
  ...base,
  homes,
  commands: {
    // @ts-expect-error two commands that land one cell in two homes
    "rooms.write": one,
    // @ts-expect-error the other of the two
    "rooms.merge": { ...write, writes: { carrier: ["name"] } },
  },
});
export const used = [staged, drifted, marks, absent, key, placed];

const proofRoute = {
  name: "Proof",
  directory: product.routes.rooms.directory,
  fields: {},
  panes: ["room"],
  subject: { field: "room", noun: "room", pane: "room", options: () => [] },
} as const;
define({ ...base, routes: { proof: proofRoute } });
define({
  ...base,
  // @ts-expect-error a misspelled subject property must be refused through a spread
  routes: { proof: { ...proofRoute, subject: { ...proofRoute.subject, optons: 1 } } },
});
// @ts-expect-error a misspelled route property must be refused through a spread
define({ ...base, routes: { proof: { ...proofRoute, optons: 1 } } });
