import { describe, expect, it } from "vite-plus/test";
import { catalogWorks, catalogWorkSpecs, type CatalogTouch } from "./catalog-work.ts";
import { commandCatalogAxes } from "./command-axes.ts";
import { editableCells } from "./command.ts";

/**
 * K3 class-wide falsifier over every ModelWrite command, discovered from the catalog axes.
 * Executable checks prove omission behavior; named pending writes remain Owed in the routes ledger.
 * Every ModelWrite must appear exactly once in one group. Pending is classification, never proof.
 * Catalog owners run the generic check below, driven by their declared `mutation`: per untouched stored key, a
 * `replace` collection must resend it unchanged, a `patch` collection may omit it but never send it changed, and
 * every touched key's before is the stored value (full before).
 */
type Keyed = Record<string, unknown>;
const cell = (value: unknown, by: "pea" | "human" = "pea") => ({ edit: { value, by } });
const definition = (name: string) => ({ sourceCategoryId: -2001040, sourceParameter: { name: "MOCP" }, relationship: "sameElement", targetParameter: { name } });
/** Per catalog owner: a stored base with several keys, a strict-subset staging, and the request's keys (what it sends). */
const catalogFixtures: { [O in keyof typeof catalogWorks]: { base: unknown; doc: unknown; keys(base: unknown): Keyed; sent(request: unknown): Keyed } } = {
  "data-tables": {
    base: {
      name: "T",
      columns: { "text:0": "A", "text:1": "B", "number:0": "N" },
      rows: { r1: { "text:0": "a1", "text:1": "b1", "number:0": "1" }, r2: { "text:0": "a2", "text:1": "b2", "number:0": "2" } },
    },
    doc: { name: cell("T"), columns: { "text:1": cell("B2", "human") }, rows: { r1: { "text:0": cell("x") } } },
    keys: (base) => {
      const b = base as { columns: Record<string, string>; rows: Record<string, Record<string, string | null>> };
      return {
        name: "T",
        ...Object.fromEntries(Object.entries(b.columns).map(([k, v]) => [`columns/${k}`, v])),
        ...Object.fromEntries(Object.entries(b.rows).flatMap(([r, c]) => Object.entries(c).map(([k, v]) => [`rows/${r}/${k}`, v]))),
      };
    },
    // The native engine binds the n-th column of a kind to pool slot n and writes a sent row positionally.
    sent: (request) => {
      const t = (request as { table: { name: string; columns: { heading: string; kind: string }[]; rows: { key: string; values: (string | null)[] }[] } }).table;
      const n: Record<string, number> = {};
      const slots = t.columns.map((c) => `${c.kind.toLowerCase()}:${(n[c.kind] = (n[c.kind] ?? -1) + 1)}`);
      return {
        name: t.name,
        ...Object.fromEntries(t.columns.map((c, i) => [`columns/${slots[i]}`, c.heading])),
        ...Object.fromEntries(t.rows.flatMap((r) => slots.map((k, i) => [`rows/${r.key}/${k}`, r.values[i] ?? null]))),
      };
    },
  },
  "parameter-links": {
    base: {
      formatVersion: 1,
      definitions: [{ id: "D1", ...definition("B1") }, { id: "D2", ...definition("B2") }],
      assignments: [{ id: "A1", definitionId: "D1", sourceElementUniqueIds: ["u-1"] }],
    },
    doc: { definitions: { D2: cell(definition("B2-new"), "human") } },
    keys: (base) => {
      const b = base as { definitions: { id: string }[]; assignments: { id: string }[] };
      return Object.fromEntries([...b.definitions.map((d) => [`definitions/${d.id}`, d]), ...b.assignments.map((a) => [`assignments/${a.id}`, a])]);
    },
    sent: (request) => (catalogFixtures["parameter-links"].keys((request as { profile: unknown }).profile)),
  },
};

function catalogCheck(owner: keyof typeof catalogWorks) {
  const work = catalogWorks[owner];
  const fixture = catalogFixtures[owner];
  expect(fixture, `${owner} has no fixture`).toBeDefined();
  const doc = work.schema.parse(fixture.doc);
  const staged = editableCells(doc, catalogWorkSpecs[owner].editable).filter(({ cell }) => cell.edit).map(({ path }) => path.join("/"));
  const plan = (work.derive as (d: unknown, b: unknown) => { request: unknown; touched: readonly CatalogTouch[] })(doc, fixture.base);
  const stored = fixture.keys(fixture.base);
  const sent = fixture.sent(plan.request);
  const touched = new Map(plan.touched.map((t) => [t.path.join("/"), t]));
  expect([...touched.keys()].sort()).toEqual(staged.sort());
  for (const [key, t] of touched) {
    expect(t.by, key).not.toBe("unknown");
    if (key in stored) expect(t.before, `${owner}: ${key} discloses its stored before`).toEqual(stored[key]);
  }
  for (const [key, value] of Object.entries(stored)) {
    if (touched.has(key)) continue;
    const mode = (work.mutation as Record<string, "replace" | "patch" | undefined>)[key.split("/")[0]!];
    expect(mode, `${owner}: collection of ${key} declares its mutation`).toBeDefined();
    // Objects compare as a superset: schema defaults the op would apply anyway may be filled in.
    if (mode === "replace" || key in sent)
      if (value && typeof value === "object") expect(sent[key], `${owner} (${mode}): unstaged ${key} survives`).toMatchObject(value);
      else expect(sent[key], `${owner} (${mode}): unstaged ${key} survives`).toEqual(value);
  }
}

/** Writes with an executable omission check in this lane. Native-only proof (fresh C#) is not a pass here. */
const checks: Record<string, { catalog: keyof typeof catalogWorks }> = {
  "data-table.apply": { catalog: "data-tables" },
  "parameter-links.apply": { catalog: "parameter-links" },
};

/** Explicit pending classification, with one Owed entry per operation in docs/features/routes/LEDGER.md. */
const pending = [
  "sheet.apply",
  "ducts.apply-heal",
  "ducts.apply-assign-fan",
  "family.apply",
  "families.apply",
  "family.build",
  "rooms.write",
  "rooms.draw",
  "rooms.partition",
  "rooms.merge",
  "takeoffs.partition",
  "takeoffs.adopt",
  "schedule.grid.push",
  "schedule.apply",
] as const;

const writes = Object.entries(commandCatalogAxes).filter(([, a]) => a.effect === "ModelWrite").map(([k]) => k).sort();

describe("every ModelWrite has an executable omission check or a named pending classification", () => {
  it("classifies every current write exactly once; new writes require an explicit classification", () => {
    expect([...Object.keys(checks), ...pending].sort()).toEqual(writes);
  });
  for (const [key, check] of Object.entries(checks))
    it(key, () => catalogCheck(check.catalog));
});
