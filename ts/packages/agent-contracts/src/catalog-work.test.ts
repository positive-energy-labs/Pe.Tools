import { describe, expect, it } from "vite-plus/test";
import { catalogWorkCommands, catalogWorks, catalogWorkSpecs, CatalogWorkRefused, mergeParameterProfile } from "./catalog-work.ts";
import type { ParameterLinkProfile } from "./parameter-links.ts";
import { commandCatalogAxes } from "./command-axes.ts";
import { bindWork, canonicalWorkKey, workKey } from "./route-state.ts";
import { address } from "./target.ts";

describe("Work identity", () => {
  const from = { session: "s", openId: "o" };
  const saved = bindWork("ducts", address("C:/Jobs/A.rvt"), undefined, from);
  const plain = bindWork("ducts", address("c:\\jobs\\a.rvt"));

  it("folds address spelling into one key and keeps Save As from until carry-over", () => {
    expect(workKey(saved)).toBe(workKey(plain));
    expect(canonicalWorkKey(saved)).toEqual({ ...plain, target: "c:\\jobs\\a.rvt", from });
    expect(workKey(bindWork("ducts", null, undefined, from))).not.toBe(workKey(plain));
  });
});

const cell = (value: unknown, by: "pea" | "human" = "pea") => ({ edit: { value, by } });

describe("data-tables keyed semantics", () => {
  const work = catalogWorks["data-tables"];
  const base = {
    name: "T",
    columns: { "text:0": "A", "text:1": "B", "number:0": "N" },
    rows: { r1: { "text:0": "a1", "text:1": "b1", "number:0": "1" }, r2: { "text:0": "a2", "text:1": "b2", "number:0": "2" } },
  };
  const derive = (doc: object) => work.derive(work.schema.parse({ name: cell("T"), ...doc }), base);

  it("a heading edit resends every column at its slot, so the others keep their parameters and values", () => {
    const { request, touched } = derive({ columns: { "text:0": cell("A2") } });
    expect(request.table.columns).toEqual([{ heading: "A2", kind: "Text" }, { heading: "B", kind: "Text" }, { heading: "N", kind: "Number" }]);
    expect(request.table.rows).toEqual([]);
    expect(touched.find((t) => t.path[0] === "columns")).toMatchObject({ before: "A", after: "A2" });
  });

  it("a sparse cell edit resends its row with every unstaged cell's stored value", () => {
    expect(derive({ rows: { r2: { "number:0": cell("9") } } }).request.table.rows).toEqual([{ key: "r2", values: ["a2", "b2", "9"] }]);
  });

  it("deletes the last slot of a kind, and refuses a delete that would remap a later column", () => {
    expect(derive({ columns: { "text:1": { edit: { delete: true } } } }).request.table.columns.map((c) => c.heading)).toEqual(["A", "N"]);
    expect(() => derive({ columns: { "text:0": { edit: { delete: true } } } })).toThrow(CatalogWorkRefused);
    expect(() => derive({ columns: { "text:5": { edit: { delete: true } } } })).toThrow(CatalogWorkRefused);
  });

  it("projects the native read by slot, and a missing table is a new one", () => {
    const native = { tables: [{ name: "T", columns: [{ heading: "B", kind: "Text", slot: 1 }, { heading: "A", kind: "Text", slot: 0 }], rows: [{ key: "r1", values: ["b", "a"] }] }] };
    expect(work.base.project(native)).toEqual({ name: "T", columns: { "text:1": "B", "text:0": "A" }, rows: { r1: { "text:1": "b", "text:0": "a" } } });
    expect(work.base.project({ tables: [] })).toBeNull();
    expect(work.derive(work.schema.parse({ name: cell("New"), columns: { "text:0": cell("A") } }), null).request.table.columns).toHaveLength(1);
  });

  it("uses the native-selected table when its name has different casing", () => {
    const doc = work.schema.parse({ name: cell("t"), columns: { "text:1": cell("B2") } });
    const native = { tables: [{ name: "T", columns: [{ heading: "A", kind: "Text", slot: 0 }, { heading: "B", kind: "Text", slot: 1 }], rows: [{ key: "r1", values: ["a", "b"] }] }] };
    const selected = work.base.project(native);
    expect(selected).not.toBeNull();
    const plan = work.derive(doc, selected);
    expect(plan.request.table.columns).toEqual([{ heading: "A", kind: "Text" }, { heading: "B2", kind: "Text" }]);
    expect(plan.request.table.rows).toEqual([]);
    expect(plan.touched.find((t) => t.path[0] === "name")).toMatchObject({ before: "T", after: "t" });
  });

  it("refuses multiple tables returned for the single-name read", () => {
    const table = { name: "T", columns: [], rows: [] };
    expect(() => work.base.project({ tables: [table, { ...table, name: "t" }] })).toThrow(CatalogWorkRefused);
  });
});

describe("parameter-links derive", () => {
  const schema = catalogWorks["parameter-links"].schema;
  const definition = {
    sourceCategoryId: -2001040,
    sourceParameter: { name: "MOCP" },
    relationship: "sameElement",
    targetParameter: { name: "Breaker" },
  };

  const stored = {
    formatVersion: 1,
    definitions: [{ id: "D1", ...definition }, { id: "D2", ...definition, targetParameter: { name: "B2" } }],
    assignments: [{ id: "A1", definitionId: "D1", sourceElementUniqueIds: ["u-1"] }],
  } as ParameterLinkProfile;
  const merge = (doc: object) => mergeParameterProfile(schema.parse(doc), stored);
  const ids = (doc: object) => merge(doc).request.profile.definitions.map((d) => d.id);

  it("keeps every stored id beside a staged one, and reports only the staged id as touched", () => {
    const plan = merge({ definitions: { D3: { edit: { value: definition, by: "pea" } } } });
    expect(plan.request.profile.definitions.map((d) => d.id)).toEqual(["D1", "D2", "D3"]);
    expect(plan.request.profile.assignments.map((a) => a.id)).toEqual(["A1"]);
    expect(plan.touched).toMatchObject([{ path: ["definitions", "D3"], before: null, after: { id: "D3", ...definition }, by: "pea" }]);
  });

  it("an edit of D1 preserves D2 and carries D1's stored before", () => {
    const edited = { ...definition, targetParameter: { name: "B1-new" } };
    const plan = merge({ definitions: { D1: cell(edited) } });
    expect(ids({ definitions: { D1: cell(edited) } })).toEqual(["D1", "D2"]);
    expect(plan.request.profile.definitions[1]).toMatchObject(stored.definitions[1]!);
    expect(plan.touched[0]).toMatchObject({ path: ["definitions", "D1"], before: stored.definitions[0], after: { id: "D1", ...edited } });
  });

  it("an explicit delete removes only the named id; deleting an absent id refuses", () => {
    expect(ids({ definitions: { D2: { edit: { delete: true } } } })).toEqual(["D1"]);
    expect(merge({ definitions: { D2: { edit: { delete: true } } } }).touched[0]).toMatchObject({ before: stored.definitions[1], after: null });
    expect(() => merge({ definitions: { D9: { edit: { delete: true } } } })).toThrow(CatalogWorkRefused);
  });

  it("refuses an empty Work and the old whole-profile shape; an unstaged cell keeps the stored id", () => {
    expect(() => merge({})).toThrow(CatalogWorkRefused);
    expect(() => mergeParameterProfile(schema.parse({ definitions: { D1: {} } }), stored)).toThrow(CatalogWorkRefused);
    expect(() => schema.parse({ profile: {} })).toThrow();
  });
});

describe("generated catalog Work commands", () => {
  it("plans as a Read and applies with the native ModelWrite's axes", () => {
    expect(Object.keys(catalogWorkCommands).sort()).toEqual([
      "data-table.apply",
      "data-table.apply.plan",
      "parameter-links.apply",
      "parameter-links.apply.plan",
    ]);
    expect(commandCatalogAxes["data-table.apply.plan"].effect).toBe("Read");
    expect(commandCatalogAxes["parameter-links.apply"]).toMatchObject({ effect: "ModelWrite", touches: ["Topology"] });
    expect(catalogWorkCommands["data-table.apply"].work.route).toBe("data-tables");
  });
});

describe("catalog Work editable census", () => {
  // Every StateCell (an object holding `edit`) in a real staged Work sits on a declared editable path.
  const cells = (value: unknown, path: string[] = []): string[][] =>
    value && typeof value === "object"
      ? "edit" in value
        ? [path]
        : Object.entries(value).flatMap(([k, v]) => cells(v, [...path, k]))
      : [];
  const covered = (path: string[], patterns: readonly (readonly (string | number)[])[]) =>
    patterns.some((p) => p.length === path.length && p.every((s, i) => s === "*" || s === path[i]));

  it.each([
    ["data-tables", { name: cell("T"), columns: { "text:0": cell("A") }, rows: { r1: { "text:0": cell("a") } } }, 3],
    ["parameter-links", { definitions: { d1: { edit: { delete: true } } }, assignments: { a1: cell({ definitionId: "d1" }) } }, 2],
  ] as const)("%s stages only declared cells", (owner, doc, count) => {
    const spec = catalogWorkSpecs[owner];
    const staged = cells(spec.schema.parse(doc));
    expect(staged).toHaveLength(count);
    for (const path of staged) expect(covered(path, spec.editable!)).toBe(true);
  });
});
