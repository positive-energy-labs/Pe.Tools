import { describe, expect, it } from "vite-plus/test";
import { catalogWorkCommands, catalogWorks, catalogWorkSpecs, CatalogWorkRefused } from "./catalog-work.ts";
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
  catalogWorks["data-tables"].derive(catalogWorks["data-tables"].schema.parse({ name: cell("T"), ...doc }));

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

  it("replaces the profile whole from cells keyed by authored id", () => {
    const doc = schema.parse({
      definitions: { d1: cell(definition), d2: { edit: { delete: true } } },
      assignments: { a1: cell({ definitionId: "d1", sourceElementUniqueIds: ["u-1"] }) },
    });
    expect(catalogWorks["parameter-links"].derive(doc)).toMatchObject({
      reconcile: true,
      profile: { definitions: [{ id: "d1" }], assignments: [{ id: "a1", sourceElementUniqueIds: ["u-1"] }] },
    });
  });

  it("refuses an empty Work, an unstaged id, and the old whole-profile shape", () => {
    expect(() => catalogWorks["parameter-links"].derive(schema.parse({}))).toThrow(CatalogWorkRefused);
    expect(() => catalogWorks["parameter-links"].derive(schema.parse({ definitions: { d1: {} } }))).toThrow();
    expect(() => schema.parse({ profile: {} })).toThrow();
  });
});

describe("generated catalog Work commands", () => {
  it("plans as a Read and applies with the native ModelWrite's axes", () => {
    expect(Object.keys(catalogWorkCommands).sort()).toEqual([
      "data-table.apply",
      "data-table.apply.preview",
      "parameter-links.apply",
      "parameter-links.apply.preview",
    ]);
    expect(commandCatalogAxes["data-table.apply.preview"].effect).toBe("Read");
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
