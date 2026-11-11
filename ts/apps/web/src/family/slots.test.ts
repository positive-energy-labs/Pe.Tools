/**
 * Slice 10 falsifier for /family (routes MAP row 10, ADR 0035 rules 1, 2 and 8): the family is the
 * subject (a `name` SubjectRef over its saved member, `[pod, path]`), the table's search, sort,
 * hidden columns and the save destination are route-owned query, and the doc-lab acceptance
 * closers are the kernel's goal pane over the route's one host read. The hand member list and the
 * `pod`/`path` identity pair are gone. The cells table, the cut-sheet pane and the anatomy stay
 * hand-drawn, so the doc-lab acceptance (MAP, "/family acceptance") is untouched: the three red
 * tests below name the kernel gap each waits on.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { decode, familyData, familyDraftSchema, podMemberCode, subjectCode } from "@pe/agent-contracts";
import { local } from "@pe/agent-contracts/slots";
import { sheetCells } from "../route/slots/sheet/index.ts";
import { titlePane } from "../shell/typed-shell.tsx";
import { familyGoal } from "./goal.ts";
import { FAMILY_MODEL_SCHEMA } from "./page.ts";
import { member, module } from "./route.ts";

const here = (file: string) => new URL(file, import.meta.url);
const CARRY = ["thread", "target", "work", "fixture", "open", "at", "atInstance", "compare"];
const box = { pod: "mech-library", path: "settings/family/Box.json" };
const pods = [{
  id: "mech-library",
  name: "Mechanical library",
  members: [
    { path: box.path, sha256: "a".repeat(64), schema: FAMILY_MODEL_SCHEMA },
    { path: "settings/checks.json", sha256: "b".repeat(64), schema: "./checks.schema.json" },
  ],
}];
const picked = { kind: "ids" as const, ids: [podMemberCode(box)] };

test("/family declares subject, query and goal, and no carry key", () => {
  const { spec, data } = module;
  expect(data.subject).toMatchObject({ field: "member", noun: "family", pane: "workspace", roster: "value" });
  expect(Object.fromEntries(Object.entries(data.fields).map(([k, f]) => [k, f.role]))).toEqual({
    pod: "query",
    query: "query",
    sort: "query",
    hidden: "query",
    member: "subject",
    stage: "pose",
    pane: "pose",
    overlay: "pose",
    drill: "pose",
    inspector: "pose",
    doc: "pose",
    selected: "selection",
  });
  expect(Object.keys(data.fields).filter((key) => CARRY.includes(key))).toEqual([]);
  // The core read is the Goal, drawn by the kernel's goal pane beside the route's one hand body.
  expect(data.goal).toBe("value");
  expect(Object.fromEntries(Object.entries(spec.panes).map(([id, p]) => [id, (p as { kernel?: string }).kernel ?? "route"])))
    .toEqual({ workspace: "route", goal: "goal" });
  expect(spec.sheet).toBeUndefined();
  expect(titlePane(spec)).toBe("workspace");
});

test("a family is a name SubjectRef over its saved member, and the roster lists Family Foundry models only", () => {
  const options = module.spec.subject!.options({ pods } as never);
  expect(options).toEqual([{ id: podMemberCode(box), label: "Mechanical library · settings/family/Box.json" }]);
  expect(decode(options[0]!.id)).toEqual({ ok: true, value: { keyKind: "name", key: [box.pod, box.path] } });
  expect(member({ member: picked })).toEqual(box);
  // No subject is the Work's own captured draft, not a member.
  expect(member({ member: { kind: "ids", ids: [] } })).toBeNull();
  expect((module.spec.core as { args(page: object): unknown }).args({ member: picked })).toEqual({ member: box });
});

test("Open member takes the member from the subject and its exact bytes from the roster", () => {
  const open = module.spec.commands.open as { input(context: object): unknown };
  expect(open.input({ page: { member: picked }, value: { pods } })).toEqual({ source: { ...box, sha256: "a".repeat(64) } });
  expect(open.input({ page: { member: { kind: "ids", ids: [] } }, value: { pods } })).toEqual({});
});

test("the Goal is the doc-lab acceptance: every Pea-staged cell is a person's to keep or revert, cited or not", () => {
  const work = familyDraftSchema.parse({
    reading: "{}",
    cells: {
      "/types/Wide/Width": { edit: { value: "40in", by: "pea", sources: [{ blockId: "p2-b7" }, { blockId: "img-3" }] } },
      "/parameters/Height/value": { edit: { value: "12in", by: "pea" } },
      "/parameters/Depth/value": { edit: { value: "6in", by: "human" } },
    },
  });
  const goal = familyGoal(work, { member: true, profileError: null, spec: true, specError: null });
  expect(goal.unresolved).toEqual([
    { id: "cell:/types/Wide/Width", says: "Keep or revert Pea's /types/Wide/Width: cited to 2 regions of the cut sheet", resolver: "person" },
    { id: "cell:/parameters/Height/value", says: "Keep or revert Pea's /parameters/Height/value: no citation", resolver: "person" },
  ]);
  expect(goal.assumed).toEqual([]);
  expect(goal.result).toEqual({ kind: "estimate", value: null, sources: [] });
  // A person's own cells leave nothing unresolved; no cut sheet is an assumption, not a blocker.
  const kept = familyDraftSchema.parse({ reading: "{}", cells: { "/a": { edit: { value: 1, by: "human" } } } });
  const done = familyGoal(kept, { member: false, profileError: null, spec: false, specError: null });
  expect(done.unresolved).toEqual([]);
  expect(done.assumed.map((c) => [c.id, c.resolver])).toEqual([["spec", { op: "family.attach-spec" }]]);
  expect(done.result).toEqual({ kind: "complete", value: "1 staged cell reviewed" });
  // Nothing captured and nothing open: the first closer names the capture.
  const empty = familyGoal(familyDraftSchema.parse({}), { member: false, profileError: null, spec: false, specError: null });
  expect(empty.next).toMatchObject({ id: "capture", resolver: { op: "family.capture" } });
  // The host read publishes it: the core value carries the Goal's fields, and decodes this one.
  const published = familyData.pick({ unresolved: true, assumed: true, next: true, inputs: true, result: true });
  expect(published.safeParse(goal).success).toBe(true);
});

test("the hand member list and the pod/path identity pair are deleted", () => {
  const mount = readFileSync(here("mount.tsx"), "utf8");
  expect(mount).not.toMatch(/ListView|useList|Family members|page\.path|path: ""/);
  expect(readFileSync(here("page.ts"), "utf8")).not.toMatch(/\bpath:/);
  expect(readFileSync(here("store.ts"), "utf8")).not.toMatch(/page\.pod|page\.path/);
});

/*
 * The plan names `local` bindings for the family's cells. The slot can draw the Work's JSON-pointer
 * cells as `local` draft cells, as /pods does, but the doc-lab acceptance needs more of each cell
 * than the kernel's StateCell carries: Pea's citation to a page, block or image region, the locate
 * verb that brings that evidence beside the cell, and the pin that keeps both through review. A
 * `SheetCell` has no citation, and the sheet pane no evidence door, so the cells stay the route's
 * table beside its cut-sheet pane. Green when a draft cell's `sources` reach the drawn cell; then
 * /family declares its sheet and the table and its codecs go.
 */
test.fails("kernel gap: cited-cell (10)", () => {
  const slot = { draft: true as const, bindings: { cells: local(z.unknown(), "subject", { json: true, rows: () => ["/types/Wide/Width"] }) } };
  const work = { cells: { "/types/Wide/Width": { edit: { value: "40in", by: "pea", sources: [{ blockId: "p2-b7" }] } } } };
  const [cell] = sheetCells(slot, { rows: [], work, model: [], read: {} });
  expect(cell).toMatchObject({ value: "40in", pending: { by: "pea" } });
  expect(cell).toHaveProperty("sources", [{ blockId: "p2-b7" }]);
});

/*
 * The plan names `parameter` bindings for the family's parameters. A `parameter` binding names one
 * Revit parameter in the route's declaration and writes it on an element by UniqueId
 * (`parameterSubject`; `apps/host/src/slots/sheet.ts`, `uniqueIdOf`). A family's parameters are
 * data, different for every family, and its rows are family types, which are `name` SubjectRefs
 * (`[family, type]`), and its write is a Family Foundry plan (`family.apply`), not a parameter
 * value on a placed element. So the kernel's write pair refuses a family type row today. Green when
 * a `parameter` cell keyed by a family type plans a write; then the type columns become bindings.
 */
test.fails("kernel gap: family-type-parameter (10)", async () => {
  const { sheetWrites } = await import("../../../host/src/slots/sheet.ts");
  const type = subjectCode({ keyKind: "name", key: ["Box", "Wide"] });
  const sheet = { bindings: { width: { kind: "parameter" as const, parameter: "Width", per: "subject" as const } } };
  expect(sheetWrites(sheet, { width: { [type]: "40in" } })).toHaveLength(1);
});

/*
 * The plan names the picture slot for the anatomy marks. `route()` projects a declared picture into
 * route data, but no pane draws from the slot (routes ledger, slice 8 residue: a ruling on a
 * kernel-drawn picture pane is owed), and the anatomy is not a scene: it is a schematic of the
 * family's parts, drawn from the family model with no captured geometry for the kernel to resolve a
 * SubjectRef against. So the anatomy and its connector marks stay a hand body. Green when the
 * kernel draws a pane from a declared picture; then /family declares it and the anatomy goes.
 */
test.fails("kernel gap: picture-pane (10)", () => {
  expect(module.data).toHaveProperty("picture");
  expect(Object.values(module.spec.panes).map((pane) => (pane as { kernel?: string }).kernel)).toContain("picture");
});
