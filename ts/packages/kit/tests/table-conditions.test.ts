import { expect, test } from "vite-plus/test";
import type { Column } from "@pe/kit/table/model";
import { readClause, visibleRows } from "@pe/kit/table/view";

const rows = [
  { id: "a", room: "Open Office", flow: 0 },
  { id: "b", room: "Corridor", flow: -4 },
  { id: "c", room: "Lab", flow: 4 },
  { id: "d", room: "Open Office", flow: 14 },
  { id: "e", room: "", flow: null },
];
type Reading = (typeof rows)[number];
const columns: Column<Reading>[] = [
  {
    key: "room",
    label: "Room Name",
    cell: () => null,
    condition: { kind: "text", read: (row) => row.room },
    search: (row) => row.room,
    sort: (row) => row.room,
  },
  {
    key: "flow",
    label: "Flow",
    cell: () => null,
    condition: { kind: "number", read: (row) => row.flow },
    search: (row) => String(row.flow ?? ""),
    sort: (row) => row.flow ?? -Infinity,
  },
];
const ids = (query: string) => visibleRows(rows, columns, { query, sorts: [] }).map((r) => r.id);

test.each([
  ["Flow=4", ["c"]],
  ["Flow!=4", ["a", "b", "d"]],
  ["Flow>4", ["d"]],
  ["Flow>=4", ["c", "d"]],
  ["Flow<4", ["a", "b"]],
  ["Flow<=4", ["a", "b", "c"]],
  ["Flow=", ["e"]],
  ["Flow!=", ["a", "b", "c", "d"]],
  ["!Flow=", ["a", "b", "c", "d"]],
  ["!Flow=4", ["a", "b", "d", "e"]],
  ["Flow>=0 Flow<14", ["a", "c"]],
  ["Flow>2e0", ["c", "d"]],
  ['"Room Name"~Office', ["a", "d"]],
  ['"Room Name"="Open Office"', ["a", "d"]],
  ['"Room Name"!="Open Office"', ["b", "c", "e"]],
  ['"Room Name"=', ["e"]],
  ['"Room Name"!=', ["a", "b", "c", "d"]],
  ['!"Room Name"~Office', ["b", "c", "e"]],
  ['"Room Name"="Open Office" Flow>=4', ["d"]],
  ["4", ["c"]],
  ["!4", ["a", "b", "d", "e"]],
] as const)("existing condition %s keeps the expected records", (query, expected) => {
  expect(ids(query)).toEqual(expected);
});

test("sort precedence remains separate from the query and preserves tie order", () => {
  const sorted = visibleRows(rows, columns, {
    query: "!Flow=",
    sorts: [
      { key: "room", dir: "asc" },
      { key: "flow", dir: "desc" },
    ],
  });
  expect(sorted.map((r) => r.id)).toEqual(["b", "c", "d", "a"]);
});

test("quotes belong around a field or value, not around a complete condition", () => {
  expect(readClause('"Room Name"="Open Office"').kind).toBe("field");
  expect(readClause('"Flow=4"').kind).toBe("broken");
});
