import { describe, expect, it } from "vite-plus/test";
import { catalogWorkCommands, catalogWorks, catalogWorkSpecs, CatalogWorkRefused, mergeParameterProfile, type CatalogTouch } from "./catalog-work.ts";
import { editableCells } from "./command.ts";
import type { ParameterLinkProfile } from "./parameter-links.ts";
import { commandCatalogAxes } from "./command-axes.ts";
import { workHandle } from "./command.ts";
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

  it("returns one handle however the key was spelled", () => {
    expect(workHandle(saved, 3)).toEqual(workHandle(plain, 3));
    expect(workHandle(saved, 3).key).not.toHaveProperty("from");
  });
});

const cell = (value: unknown, by: "pea" | "human" = "pea") => ({ edit: { value, by } });

/**
 * K3 per-owner falsifier, discovered from `catalogWorks` (an owner without a fixture fails): a stored base with
 * several keys, a strict-subset staging, and the owner's model of what its native op leaves (`outcome`, from
 * the census of the engine). Generic assertions: touched names exactly the staged cells with their stored
 * before and author; every stored key the Work did not touch survives the op; a replace op's evidence before is
 * the full stored state.
 */
type Keyed = Record<string, unknown>;
const fixtures: { [O in keyof typeof catalogWorks]: {
  base: unknown;
  doc: unknown;
  keys(base: unknown): Keyed;
  outcome(base: unknown, request: unknown): Keyed;
} } = {
  "data-tables": {
    base: {
      columns: { "text:0": "A", "text:1": "B", "number:0": "N" },
      rows: { r1: { "text:0": "a1", "text:1": "b1", "number:0": "1" }, r2: { "text:0": "a2", "text:1": "b2", "number:0": "2" } },
    },
    doc: { name: cell("T"), columns: { "text:1": cell("B2", "human") }, rows: { r1: { "text:0": cell("x") } } },
    keys: (base) => {
      const b = base as { columns: Record<string, string>; rows: Record<string, Record<string, string | null>> };
      return {
        name: "T",
        ...Object.fromEntries(Object.entries(b.columns).map(([k, v]) => [`columns/${k}`, v])),
        ...Object.fromEntries(Object.entries(b.rows).flatMap(([r, cells]) => Object.entries(cells).map(([k, v]) => [`rows/${r}/${k}`, v]))),
      };
    },
    // DataTableEngine: columns replaced whole, the n-th of a kind binds slot n; sent rows rewrite positionally; rows upsert.
    outcome: (base, request) => {
      const b = base as { rows: Record<string, Record<string, string | null>> };
      const t = (request as { table: { name: string; columns: { heading: string; kind: string }[]; rows: { key: string; values: (string | null)[] }[] } }).table;
      const n: Record<string, number> = {};
      const slots = t.columns.map((c) => `${c.kind.toLowerCase()}:${(n[c.kind] = (n[c.kind] ?? -1) + 1)}`);
      const rows = structuredClone(b.rows);
      for (const row of t.rows) rows[row.key] = { ...rows[row.key], ...Object.fromEntries(slots.map((k, i) => [k, row.values[i] ?? null])) };
      return {
        name: t.name,
        ...Object.fromEntries(t.columns.map((c, i) => [`columns/${slots[i]}`, c.heading])),
        ...Object.fromEntries(Object.entries(rows).flatMap(([r, cells]) => Object.entries(cells).filter(([k]) => slots.includes(k)).map(([k, v]) => [`rows/${r}/${k}`, v]))),
      };
    },
  },
  "parameter-links": {
    base: {
      formatVersion: 1,
      definitions: [
        { id: "D1", sourceCategoryId: -2001040, sourceParameter: { name: "MOCP" }, relationship: "sameElement", targetParameter: { name: "B1" } },
        { id: "D2", sourceCategoryId: -2001040, sourceParameter: { name: "MOCP" }, relationship: "sameElement", targetParameter: { name: "B2" } },
      ],
      assignments: [{ id: "A1", definitionId: "D1", sourceElementUniqueIds: ["u-1"] }],
    },
    doc: { definitions: { D2: cell({ sourceCategoryId: -2001040, sourceParameter: { name: "MOCP" }, relationship: "sameElement", targetParameter: { name: "B2-new" } }, "human") } },
    keys: (base) => {
      const b = base as { definitions: { id: string }[]; assignments: { id: string }[] };
      return Object.fromEntries([...b.definitions.map((d) => [`definitions/${d.id}`, d.id]), ...b.assignments.map((a) => [`assignments/${a.id}`, a.id])]);
    },
    // revit.apply.parameter-links reconciles the profile whole: what is sent is what remains.
    outcome: (_base, request) => {
      const p = (request as { profile: { definitions: { id: string }[]; assignments: { id: string }[] } }).profile;
      return Object.fromEntries([...p.definitions.map((d) => [`definitions/${d.id}`, d.id]), ...p.assignments.map((a) => [`assignments/${a.id}`, a.id])]);
    },
  },
};

describe("every catalog Work owner preserves what it does not touch", () => {
  for (const [owner, work] of Object.entries(catalogWorks) as [keyof typeof catalogWorks, (typeof catalogWorks)[keyof typeof catalogWorks]][])
    it(owner, () => {
      const fixture = fixtures[owner];
      expect(fixture, `${owner} has no K3 fixture`).toBeDefined();
      expect(work.base.op).toMatch(/^revit\.detail\./);
      const doc = work.schema.parse(fixture.doc);
      const staged = editableCells(doc, catalogWorkSpecs[owner].editable).filter(({ cell }) => cell.edit).map(({ path }) => path.join("/"));
      const plan = (work.derive as (d: unknown, b: unknown) => { request: unknown; touched: readonly CatalogTouch[] })(doc, fixture.base);
      expect(plan.touched.map((t) => t.path.join("/")).sort()).toEqual(staged.sort());
      for (const t of plan.touched) expect(t.by, t.path.join("/")).not.toBe("unknown");
      const before = fixture.keys(fixture.base);
      const after = fixture.outcome(fixture.base, plan.request);
      const touchedIds = new Set(plan.touched.map((t) => t.path.join("/")));
      for (const [key, value] of Object.entries(before))
        if (!touchedIds.has(key)) expect(after[key], `${owner}: unstaged ${key} survives`).toEqual(value);
      expect(work.mutation).toBe("replace");
    });
});

describe("data-tables keyed semantics", () => {
  const work = catalogWorks["data-tables"];
  const base = fixtures["data-tables"].base as Parameters<typeof work.derive>[1];
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
    const doc = work.schema.parse({ name: cell("T") });
    const native = { tables: [{ name: "T", columns: [{ heading: "B", kind: "Text", slot: 1 }, { heading: "A", kind: "Text", slot: 0 }], rows: [{ key: "r1", values: ["b", "a"] }] }] };
    expect(work.base.project(native, doc)).toEqual({ columns: { "text:1": "B", "text:0": "A" }, rows: { r1: { "text:1": "b", "text:0": "a" } } });
    expect(work.base.project({ tables: [] }, doc)).toBeNull();
    expect(work.derive(work.schema.parse({ name: cell("New"), columns: { "text:0": cell("A") } }), null).request.table.columns).toHaveLength(1);
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
