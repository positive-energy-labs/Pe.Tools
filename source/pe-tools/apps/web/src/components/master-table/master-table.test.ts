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

test("clustered columns: a resumed group still renders, and names itself on the console", () => {
  const scrambled: Column<Fam>[] = [columns[1]!, columns[2]!, columns[0]!];
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: string) => warnings.push(message);
  try {
    // The span math never lies about the columns it was handed — two "identity" headers.
    expect(clusters(scrambled)).toEqual([
      { group: "identity", span: 1 },
      { group: undefined, span: 1 },
      { group: "identity", span: 1 },
    ]);
  } finally {
    console.warn = original;
  }
  expect(warnings.length).toBe(1);
  expect(warnings[0]).toContain("not contiguous");
});

test("edit commit: junk is refused, min clamps, integers truncate", () => {
  expect(parseCell("14")).toBe(14);
  expect(parseCell("  ")).toBe(null);
  expect(parseCell("abc")).toBe(null);
  expect(parseCell("-3", { min: 0 })).toBe(0);
  expect(parseCell("2.7", { integer: true })).toBe(2);
});

test("match columns: a multi-valued filter overrides facet equality", () => {
  // Flags-style column: options are declared, matching is a predicate, no facet at all.
  const flags: Record<string, string[]> = { a: ["low-ceiling"], b: [], c: ["low-ceiling", "odd"] };
  const flagCol: Column<Fam> = {
    key: "flags",
    label: "flags",
    options: [
      { value: "any", label: "any open" },
      { value: "none", label: "none open" },
      { value: "odd", label: "odd" },
    ],
    match: (row, value) => {
      const open = flags[row.id] ?? [];
      if (value === "any") return open.length > 0;
      if (value === "none") return open.length === 0;
      return open.includes(value);
    },
    cell: () => null,
  };
  const all = [...columns, flagCol];
  expect(applyFilters(rows, all, { flags: "any" }).map((r) => r.id)).toEqual(["a", "c"]);
  expect(applyFilters(rows, all, { flags: "none" }).map((r) => r.id)).toEqual(["b"]);
  expect(applyFilters(rows, all, { flags: "odd" }).map((r) => r.id)).toEqual(["c"]);
  // Declared options win over derivation, so the vocabulary stays stable with no facet.
  expect(facetOptions(rows, flagCol).map((o) => o.value)).toEqual(["any", "none", "odd"]);
});
