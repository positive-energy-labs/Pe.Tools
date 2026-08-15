/** The table's law, on a tiny fixture: sort, filter, and the edit-commit gate. */
import { expect, test } from "vite-plus/test";

import {
  applyFilters,
  applySort,
  clusters,
  facetOptions,
  parseCell,
  toggleSort,
  type Column,
} from "#/components/master-table/model";

interface Fam {
  id: string;
  name: string;
  cat: string;
  params: number;
}

const rows: Fam[] = [
  { id: "a", name: "VAV Box", cat: "mech", params: 12 },
  { id: "b", name: "Diffuser", cat: "mech", params: 4 },
  { id: "c", name: "Panelboard", cat: "elec", params: 9 },
];

const columns: Column<Fam>[] = [
  {
    key: "name",
    label: "name",
    group: "identity",
    search: (r) => r.name,
    sort: (r) => r.name,
    cell: (r) => r.name,
  },
  {
    key: "cat",
    label: "category",
    group: "identity",
    facet: (r) => r.cat,
    sort: (r) => r.cat,
    cell: (r) => r.cat,
  },
  { key: "params", label: "params", right: true, sort: (r) => r.params, cell: (r) => r.params },
];

const ids = (rs: Fam[]) => rs.map((r) => r.id).join("");

test("filter: a column facet narrows the scope; free text searches only search columns", () => {
  expect(ids(applyFilters(rows, columns, { cat: "mech" }))).toBe("ab");
  expect(ids(applyFilters(rows, columns, {}, "panel"))).toBe("c");
  expect(ids(applyFilters(rows, columns, { cat: "elec" }, "vav"))).toBe("");
  // options are the honest vocabulary of the rows, sorted
  expect(facetOptions(rows, columns[1]!).map((o) => o.value)).toEqual(["elec", "mech"]);
});

test("sort: click sorts, second click flips, shift-click stacks a second key", () => {
  let sorts = toggleSort([], "params", false);
  expect(ids(applySort(rows, columns, sorts))).toBe("bca");

  sorts = toggleSort(sorts, "params", false);
  expect(sorts).toEqual([{ key: "params", dir: "desc" }]);
  expect(ids(applySort(rows, columns, sorts))).toBe("acb");

  // multi-sort: category ascending, then params descending inside it
  sorts = toggleSort(toggleSort([], "cat", false), "params", true);
  expect(sorts).toEqual([
    { key: "cat", dir: "asc" },
    { key: "params", dir: "asc" },
  ]);
  sorts = toggleSort(sorts, "params", true);
  expect(ids(applySort(rows, columns, sorts))).toBe("cab");
});

test("clustered columns: contiguous group members share one spanning header", () => {
  expect(clusters(columns)).toEqual([
    { group: "identity", span: 2 },
    { group: undefined, span: 1 },
  ]);
});

test("edit commit: junk is refused, min clamps, integers truncate", () => {
  expect(parseCell("14")).toBe(14);
  expect(parseCell("  ")).toBe(null);
  expect(parseCell("abc")).toBe(null);
  expect(parseCell("-3", { min: 0 })).toBe(0);
  expect(parseCell("2.7", { integer: true })).toBe(2);
});
