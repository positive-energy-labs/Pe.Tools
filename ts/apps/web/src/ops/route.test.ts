import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { local } from "@pe/agent-contracts/slots";
import { decode } from "../../../../packages/agent-contracts/src/subject-ref.ts";
import { sheetCells } from "../route/slots/sheet/index.ts";
import { nameOf, oneName } from "../route/typed-route.ts";
import { module } from "./route";

const opRef = (key: string) => oneName(key).ids[0]!;

/*
 * Slice 10 (MAP row 10), ops: the op is the subject slot's SubjectRef (keyKind `name`), the receipt
 * id is route-owned `query`, and the kernel's subject picker is the only op chooser: the route's
 * hand Ladder is gone. The op input stays the route's request form; see the kernel gap below.
 */
test("slice 10 ops: the op is a name SubjectRef subject, actionId is query, and the route draws no op chooser", () => {
  const { data, spec } = module;
  expect(data.subject).toMatchObject({ field: "op", noun: "operation", pane: "main" });
  expect(data.fields.op).toMatchObject({ role: "subject", url: "push" });
  expect(data.fields.actionId).toMatchObject({ role: "query", url: "push" });
  expect(Object.keys(data.fields).sort()).toEqual(["actionId", "op", "selected"]);
  const options = spec.subject!.options({
    catalog: { operations: [{ key: "revit.context.summary", displayName: "Context" } as never] },
    receipts: [],
    receipt: [],
  });
  expect(options).toEqual([{ id: opRef("revit.context.summary"), label: "Context" }]);
  expect(decode(options[0]!.id)).toEqual({
    ok: true,
    value: { keyKind: "name", key: ["revit.context.summary"] },
  });
  expect(nameOf(oneName("revit.context.summary"))).toBe("revit.context.summary");
  expect(nameOf(oneName(""))).toBe("");
  // One capability, one choice path: no route body draws its own op chooser beside the kernel's.
  for (const file of ["mount.tsx", "workspace.tsx"])
    expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toMatch(/Ladder|query\(\{ op/);
});

/*
 * kernel gap: sheet-schema-input (ops). MAP row 10 plans the op input as `local` sheet bindings, but
 * an op request is a JSON Schema document (nested objects, arrays, `x-options` fields that read the
 * target document's options) chosen at runtime from the live catalog, and the sheet slot draws one
 * scalar StateCell per declared binding per row. Ops also has no Work to stage in (it is a
 * person-only console with no `edits`). Until the kernel can draw a schema-shaped binding, the
 * request form (`ops/form.tsx`, the settings renderer) stays the route's own.
 */
test.fails("kernel gap: sheet-schema-input (ops): a local binding draws one cell per request field", () => {
  const slot = { bindings: { request: local({} as never) } };
  const cells = sheetCells(slot, {
    rows: [],
    work: { request: { scope: { kind: "view" }, limit: 5 } },
    model: [],
  });
  expect(cells.map((c) => c.label)).toEqual(["request.scope.kind", "request.limit"]);
});
