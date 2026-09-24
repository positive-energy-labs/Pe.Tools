import { expect, test } from "vite-plus/test";

import { resolveStateColumn } from "#/components/master-table/master-table-columns";
import type { Column } from "#/components/master-table/model";
import { conditionValues, visibleRows } from "#/components/master-table/view";

interface Room {
  id: string;
  stage: string;
  flags: string[];
}

const rooms: Room[] = [
  { id: "a", stage: "audit", flags: ["tiny"] },
  { id: "b", stage: "sync", flags: [] },
  { id: "c", stage: "audit", flags: ["tiny", "tall"] },
];
const columns: Column<Room>[] = [
  { key: "stage", label: "stage", facet: (room) => room.stage, cell: () => null },
  {
    key: "flags",
    label: "flags",
    cell: () => null,
    match: (room, value) => (value === "any" ? room.flags.length > 0 : room.flags.includes(value)),
    options: ["any", "tiny", "tall"].map((value) => ({ value, label: value })),
  },
];
const ids = (query: string) =>
  visibleRows(rooms, columns, { sorts: [], query }).map((room) => room.id);

test("a facet column is a query field: = narrows, ! negates, match reads multi-valued cells", () => {
  expect(ids("stage=audit")).toEqual(["a", "c"]);
  expect(ids("!stage=audit")).toEqual(["b"]);
  expect(ids("flags=tall")).toEqual(["c"]);
  expect(ids("flags!=any")).toEqual(["b"]);
});

test("a facet field suggests its values with counts over the rows in scope (ruling 26)", () => {
  const [stage, flags] = columns.map((column) => resolveStateColumn(column).condition!);
  expect(conditionValues(rooms, stage!)).toEqual([
    { value: "audit", count: 2 },
    { value: "sync", count: 1 },
  ]);
  const scope = visibleRows(rooms, columns, { sorts: [], query: "stage=sync" });
  expect(conditionValues(scope, flags!)).toEqual([
    { value: "any", count: 0 },
    { value: "tiny", count: 0 },
    { value: "tall", count: 0 },
  ]);
});
