/**
 * Slice 10 falsifier for /pods (routes MAP row 10, ADR 0035 rules 1, 3 and 8): the route draws
 * through the slots. The member is the subject (a `name` SubjectRef over `[pod, path]`), its Work
 * draws in a route-local JSON editor over the same saved bytes because the frozen Domain has no
 * arbitrary JSON arm. Its unresolved list stays the kernel's goal pane. The driver presses the steps in
 * the slice 10 receipt; this pins the declaration and the cells.
 */
import { expect, test } from "vite-plus/test";
import { podMemberCode, podMemberOfCode } from "@pe/agent-contracts";
import { memberFields, fieldsEmpty } from "./fields.tsx";
import { titlePane } from "../shell/typed-shell.tsx";
import { member, module } from "./route.ts";

const code = podMemberCode({ pod: "share-ducts", path: "settings/checks.json" });
const saved = '{"$schema":"./checks.schema.json","maxSystems":25,"names":["Elbow","Tee"],"a/b":1}';
const read = (basis: boolean, fields: Record<string, unknown> = {}) => ({
  scope: { pod: "share-ducts", path: "settings/checks.json", runs: "member" as const },
  member: {
    member: { pod: "share-ducts", path: "settings/checks.json" },
    content: saved,
    sha256: "f".repeat(64),
  },
  work: {
    basis: basis
      ? {
          member: { pod: "share-ducts", path: "settings/checks.json" },
          rawContent: saved,
          sha256: "f".repeat(64),
        }
      : null,
    fields,
  },
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
  expect(code).toBe('name:["share-ducts","settings%2fchecks.json"]');
  expect(podMemberOfCode(code)).toEqual({ pod: "share-ducts", path: "settings/checks.json" });
  expect(podMemberOfCode("workspace:share-ducts")).toBeNull();
  expect(member({ member: { kind: "ids", ids: [code] } })).toEqual({
    pod: "share-ducts",
    path: "settings/checks.json",
  });
});

test("/pods declares subject, goal and query, and keeps arbitrary JSON outside the sheet grammar", () => {
  const { spec, data } = module;
  expect(spec.subject).toMatchObject({ field: "member", noun: "member", pane: "members" });
  // The member editor occupies the same pane; the subject and Goal remain kernel slots.
  expect(
    Object.fromEntries(
      Object.entries(spec.panes).map(([id, p]) => [
        id,
        (p as { kernel?: string }).kernel ?? (p.subjectList ? "subject" : "route"),
      ]),
    ),
  ).toEqual({ members: "subject", runs: "route", sheet: "route", goal: "goal" });
  expect(Object.keys(spec.panes)).not.toContain("spec");
  // `runs` is the one query; the member is the subject field; the core read is the Goal.
  expect(data.fields.runs?.role).toBe("query");
  expect(data.fields.member).toMatchObject({ role: "subject", cardinality: "many" });
  expect(data.subject).toMatchObject({ field: "member", pane: "members" });
  expect(data.goal).toBe("value");
  expect(data.sheet).toBeUndefined();
  // Arbitrary JSON never reaches Revit through the sheet pair; Save remains the route's own door.
  expect(Object.keys(spec.verbs).sort()).toEqual(["adopt", "open", "save", "saveNew"]);
  // A person can Start this Work: the route seeds an empty one for Open saved bytes to fill.
  expect(spec.edits?.seed?.({} as never, null)).toEqual({ basis: null, fields: {} });
  // The title rides the sheet's head, the first pane after the subject list.
  expect(titlePane(spec)).toBe("sheet");
});

test("the member pane draws one route-local JSON cell per top-level property, over the saved bytes", () => {
  const cells = memberFields(read(true, { "/maxSystems": { edit: { value: 26, by: "human" } } }));
  expect(cells.map((c) => [c.row, c.label, c.value, c.model, c.source])).toEqual([
    ["/$schema", "$schema", "./checks.schema.json", "./checks.schema.json", "model"],
    ["/maxSystems", "maxSystems", 26, 25, "work"],
    ["/names", "names", ["Elbow", "Tee"], ["Elbow", "Tee"], "model"],
    ["/a~1b", "a/b", 1, 1, "model"],
  ]);
  expect(cells.every((c) => !c.refusal)).toBe(true);
});

test("before Open saved bytes the cells refuse with the reason, so a save cannot replace the file", () => {
  const cells = memberFields(read(false), null);
  expect(cells.length).toBe(4);
  expect(new Set(cells.map((c) => c.refusal))).toEqual(
    new Set(["Open saved bytes before editing: this Work has no saved basis"]),
  );
});

test("the sheet's empty states name their exit", () => {
  const empty = fieldsEmpty;
  expect(empty(null)).toBe("Pick a member on the left to edit its Work");
  expect(empty({ ...read(true), scope: { pod: "p", path: "src/Probe.cs", runs: "member" } })).toBe(
    "src/Probe.cs is source, not a JSON spec; pick a .json member",
  );
  expect(empty({ ...read(true), draft: "[1]" })).toBe(
    "The draft is not a JSON object; Pea can repair it as raw text",
  );
  expect(empty(read(true))).toBeNull();
});
