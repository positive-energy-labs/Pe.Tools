/**
 * Slice 10 falsifier for /pods (routes MAP row 10, ADR 0035 rules 1, 3 and 8): the route draws
 * through the slots. The member is the subject (a `name` SubjectRef over `[pod, path]`), its Work
 * draws as the kernel's sheet of `local` cells over the saved bytes, its unresolved list is the
 * kernel's goal pane, and no hand-drawn spec editor is left. Live, the driver presses the steps in
 * the slice 10 receipt; this pins the declaration and the cells.
 */
import { expect, test } from "vite-plus/test";
import { podMemberCode, podMemberOfCode } from "@pe/agent-contracts";
import { sheetCells } from "../route/slots/sheet/index.ts";
import { titlePane } from "../shell/typed-shell.tsx";
import { member, module } from "./route.ts";

const code = podMemberCode({ pod: "share-ducts", path: "settings/checks.json" });
const saved = '{"$schema":"./checks.schema.json","maxSystems":25,"names":["Elbow","Tee"],"a/b":1}';
const read = (basis: boolean, fields: Record<string, unknown> = {}) => ({
  scope: { pod: "share-ducts", path: "settings/checks.json", runs: "member" as const },
  member: { member: { pod: "share-ducts", path: "settings/checks.json" }, content: saved, sha256: "f".repeat(64) },
  work: { basis: basis ? { member: { pod: "share-ducts", path: "settings/checks.json" }, rawContent: saved, sha256: "f".repeat(64) } : null, fields },
  draft: saved,
  composition: null,
  schemaRef: "./checks.schema.json",
  runs: [],
  unresolved: [],
  assumed: [],
  next: null,
  inputs: [],
  result: { kind: "complete" as const, value: "settings/checks.json is ready to run" },
});

test("the member is a name SubjectRef over [pod, path], and only that kind decodes", () => {
  expect(code).toBe("name:[\"share-ducts\",\"settings%2fchecks.json\"]");
  expect(podMemberOfCode(code)).toEqual({ pod: "share-ducts", path: "settings/checks.json" });
  expect(podMemberOfCode("workspace:share-ducts")).toBeNull();
  expect(member({ member: { kind: "ids", ids: [code] } })).toEqual({ pod: "share-ducts", path: "settings/checks.json" });
});

test("/pods declares subject, sheet, goal and query, and keeps no hand-drawn spec pane", () => {
  const { spec, data } = module;
  expect(spec.subject).toMatchObject({ field: "member", noun: "member", pane: "members" });
  // The panes: the subject list, the kernel's sheet and goal, and the run history (a result, not an editor).
  expect(Object.fromEntries(Object.entries(spec.panes).map(([id, p]) => [id, (p as { kernel?: string }).kernel ?? (p.subjectList ? "subject" : "route")])))
    .toEqual({ members: "subject", runs: "route", sheet: "sheet", goal: "goal" });
  expect(Object.keys(spec.panes)).not.toContain("spec");
  // `runs` is the one query; the member is the subject field; the core read is the Goal.
  expect(data.fields.runs?.role).toBe("query");
  expect(data.fields.member).toMatchObject({ role: "subject", cardinality: "many" });
  expect(data.subject).toMatchObject({ field: "member", pane: "members" });
  expect(data.goal).toBe("value");
  expect(data.sheet?.bindings.fields).toMatchObject({ kind: "local", per: "subject", json: true });
  // A local-only sheet never reaches Revit, so the kernel adds no sheet write verb; Save is the route's own.
  expect(Object.keys(spec.commands).sort()).toEqual(["adopt", "open", "save", "saveNew"]);
  // A person can Start this Work: the route seeds an empty one for Open saved bytes to fill.
  expect(spec.edits?.seed?.({} as never, null)).toEqual({ basis: null, fields: {} });
  // The title rides the sheet's head, the first pane after the subject list.
  expect(titlePane(spec)).toBe("sheet");
});

test("the sheet draws one local JSON cell per top-level property, over the saved bytes", () => {
  const slot = module.spec.sheet!;
  const cells = sheetCells(slot, { rows: [code], work: read(true, { "/maxSystems": { edit: { value: 26, by: "human" } } }).work, model: [], read: read(true, { "/maxSystems": { edit: { value: 26, by: "human" } } }) });
  expect(cells.map((c) => [c.row, c.label, c.value, c.model, c.source, c.json])).toEqual([
    ["/$schema", "$schema", "./checks.schema.json", "./checks.schema.json", "model", true],
    ["/maxSystems", "maxSystems", 26, 25, "work", true],
    ["/names", "names", ["Elbow", "Tee"], ["Elbow", "Tee"], "model", true],
    ["/a~1b", "a/b", 1, 1, "model", true],
  ]);
  expect(cells.every((c) => c.kind === "local" && !c.drift && !c.refusal)).toBe(true);
});

test("before Open saved bytes the cells refuse with the reason, so a save cannot replace the file", () => {
  const cells = sheetCells(module.spec.sheet!, { rows: [code], work: null, model: [], read: read(false) });
  expect(cells.length).toBe(4);
  expect(new Set(cells.map((c) => c.refusal))).toEqual(new Set(["Open saved bytes before editing: this Work has no saved basis"]));
});

test("the sheet's empty states name their exit", () => {
  const empty = module.spec.sheet!.empty!;
  expect(empty(null)).toBe("Pick a member on the left to edit its Work");
  expect(empty({ ...read(true), scope: { pod: "p", path: "src/Probe.cs", runs: "member" } })).toBe(
    "src/Probe.cs is source, not a JSON spec; pick a .json member",
  );
  expect(empty({ ...read(true), draft: "[1]" })).toBe("The draft is not a JSON object; Pea can repair it as raw text");
  expect(empty(read(true))).toBeNull();
});
