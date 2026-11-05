import { describe, expect, it } from "vite-plus/test";
import { catalogWorkCommands, catalogWorks, catalogWorkSpecs, CatalogWorkRefused, mergeParameterProfile } from "./catalog-work.ts";
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

const cell = (value: unknown) => ({ edit: { value } });
const table = (doc: object) =>
  catalogWorks["data-tables"].derive(catalogWorks["data-tables"].schema.parse({ name: cell("T"), ...doc })).request;

describe("data-tables derive", () => {
  it("sends columns by pool slot, Text before Number, and leaves unstaged rows untouched", () => {
    expect(
      table({
        columns: { "number:0": cell("N"), "text:1": cell("B"), "text:0": cell("A") },
        rows: { r1: { "text:0": cell("a"), "text:1": cell(null) }, r2: {} },
      }),
    ).toEqual({
      table: {
        name: "T",
        columns: [{ heading: "A", kind: "Text" }, { heading: "B", kind: "Text" }, { heading: "N", kind: "Number" }],
        rows: [{ key: "r1", values: ["a", null] }],
      },
    });
  });

  it("refuses a slot gap, which the ordinal engine would fill with the next column", () => {
    expect(() => table({ columns: { "text:0": { edit: { delete: true } }, "text:1": cell("B") } })).toThrow(
      CatalogWorkRefused,
    );
  });

  it("refuses a skipped cell before a staged one, which the native op would clear", () => {
    expect(() =>
      table({ columns: { "text:0": cell("A"), "text:1": cell("B") }, rows: { r1: { "text:1": cell("b") } } }),
    ).toThrow(CatalogWorkRefused);
  });

  it.each([
    { "number:0": cell("9") },
    { "text:0": cell("a"), "number:0": cell("9") },
  ])("refuses staged row cells outside the authored column set", (cells) => {
    expect(() => table({ columns: { "text:0": cell("A") }, rows: { r1: cells } }))
      .toThrow("Row r1: number:0 is not a staged column");
  });

  it("has no authored order and no heading-keyed columns", () => {
    expect(() => table({ order: ["text:1", "text:0"] })).toThrow();
    expect(() => table({ columns: { Condition: cell("A") } })).toThrow();
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
