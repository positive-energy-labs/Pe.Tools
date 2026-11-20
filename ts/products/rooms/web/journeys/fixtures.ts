import { product, regionCode } from "@pe/rooms-contract/product";
import { mounted, path, type Native } from "../../../../tests/e2e/mounted.test-support.tsx";
import { module as rooms } from "../routes/rooms/route.ts";
import { module as takeoffs } from "../routes/takeoffs/route.ts";

const modules = { rooms, takeoffs };
const reads = Object.values(product.readings).map(({ handle }) => handle.key);
export const journey = (route: keyof typeof modules, native: Native, search?: URLSearchParams) =>
  mounted(modules[route], reads, native, { search });

export const FLOOR = "8a0c1e3f-0000-4000-8000-000000000001-000026dc";
export const CEILING = "8a0c1e3f-0000-4000-8000-000000000001-0014edcd";
export const GONE = "8a0c1e3f-0000-4000-8000-000000000001-00715157";
/** Snowdon: one level carries a floor plan and a ceiling plan of one name. */
export const levels = [
  {
    name: "Snowdon level",
    elevation: 0,
    views: [
      { uniqueId: FLOOR, name: "L2", type: "FloorPlan" },
      { uniqueId: CEILING, name: "L2", type: "CeilingPlan" },
    ],
  },
];
const id = (n: number) => `8a0c1e3f-0000-4000-8000-00000000000${n}-0000100${n}`;
const square = (x: number) => [
  [x, 0],
  [x + 10, 0],
  [x + 10, 10],
  [x, 10],
];
export const region = (n: number, patch: Record<string, unknown> = {}) => ({
  elementId: 4096 + n,
  uniqueId: id(n),
  view: "L2",
  level: "Snowdon level",
  role: "room",
  zone: id(0),
  name: `Room ${n}`,
  type: "",
  sqft: 100,
  outer: square(n * 10),
  holes: [],
  label: [n * 10 + 5, 5],
  runId: "run-1",
  touched: false,
  locked: false,
  stale: false,
  ...patch,
});
export const code = (n: number) => regionCode(id(n));
export const zone = region(0, { role: "zone", zone: null, name: "West zone", sqft: 700 });
export const reading = { at: path, version: null, observedAt: "2026-11-20T00:00:00.000Z" };
