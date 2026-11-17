import { expect, it } from "vite-plus/test";
import { z } from "zod";
import { FAN_CELLS, FAN_INPUTS, authoredValueSchema, fanBindingRows, fanClaimSchema, fanInputShape, fanIssueSchema, fanParameterCohortSchema, fanWriteRows, sourcedValueSchema } from "./fans-inputs.ts";
import { VALUE_SOURCES, resolveValue } from "./work-value.ts";
import { DUCT_UNIT_KINDS, FAN_BLOCKER_KINDS } from "@pe/host-contracts/generated";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { draftEditSchema } from "./draft.ts";
import { fansDocumentSchema } from "./fans.ts";
import { subjectCode, uniqueIdSchema } from "./subject-ref.ts";

it("airflow is a plain number with caller-cited cell evidence, and legacy objects are refused", () => {
  const key = subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("fixture:1") });
  for (const segment of ["flows", "equipmentFlows"]) {
    const doc = { [segment]: { [key]: { edit: { value: 250, ref: "submittal:page-2", by: "pea" } } } };
    expect(fansDocumentSchema.parse(doc)).toMatchObject(doc);
    expect(fansDocumentSchema.safeParse({ [segment]: { [key]: { edit: { value: { cfm: 250, source: "legacy" } } } } }).success).toBe(false);
  }
  const cell = z.strictObject({ edit: draftEditSchema(z.number()) });
  expect(cell.parse({ edit: { value: 250, ref: "submittal:page-2" } })).toEqual({ edit: { value: 250, ref: "submittal:page-2" } });
  for (const ref of ["", " "]) expect(cell.safeParse({ edit: { value: 250, ref } }).success).toBe(false);
});

it("decoder words are exactly the native snapshot catalog vocabulary", () => {
  const definitions = JSON.parse(hostOpCatalog.find(op => op.key === "ducts.snapshot.walk")!.responseSchemaJson).definitions;
  expect(DUCT_UNIT_KINDS).toEqual(definitions.DuctUnitKind.enum);
  expect(FAN_BLOCKER_KINDS).toEqual(definitions.FanBlockerKind.enum);
});

const value = { status: "valid", value: 1, source: "Work", author: "human", ref: "submittal:fan-1", version: 2, units: "in-wg" };
it("accepts a backflow blocker on the wire", () => {
  const blocker = { id: "backflow:1", kind: "backflow", elementId: 1, severity: "blocking", closer: { kind: "none", reason: "Reverse flow requires a ruling" } };
  expect(fanIssueSchema.parse(blocker)).toEqual(blocker);
  expect(fanIssueSchema.parse({ ...blocker, kind: "direction-mismatch", severity: "warning" }).kind).toBe("direction-mismatch");
});
it("requires evidence and authentic caller identity for valid staged values", () => {
  const schema = sourcedValueSchema(z.number().nonnegative());
  expect(schema.parse(value)).toEqual(value);
  for (const author of [null, "unknown"])
    expect(schema.safeParse({ ...value, author }).success).toBe(false);
  expect(schema.safeParse({ ...value, ref: " " }).success).toBe(false);
  expect(schema.safeParse({ ...value, source: "model", author: null }).success).toBe(true);
  expect(schema.safeParse({ ...value, status: "invalid", value: null, author: null }).success).toBe(true);
  expect(schema.safeParse({ ...value, status: "missing", source: "none", value: null, author: null, ref: null, version: null }).success).toBe(true);
  expect(authoredValueSchema(z.number()).safeParse({ value: 1, source: "run", author: "unknown", ref: "run:1", version: null }).success).toBe(false);
  expect(resolveValue({ Work: { value: -1, author: "pea", ref: "Work:1" }, model: { value: 2, author: null, ref: "model:1" } }, null, n => n >= 0))
    .toMatchObject({ value: null, status: "invalid", source: "Work", author: "pea", ref: "Work:1" });
});
it("a complete claim refuses pressure, coverage or blocking damage", () => {
  const claim = { kind: "complete", basis: "read:1", requiredEspInWg: 1, coverage: [], blockingIds: [] };
  expect(fanClaimSchema.safeParse(claim).success).toBe(true);
  for (const requiredEspInWg of [-1, Infinity, NaN]) expect(fanClaimSchema.safeParse({ ...claim, requiredEspInWg }).success).toBe(false);
  expect(fanClaimSchema.safeParse({ ...claim, blockingIds: ["no-flow:1"] }).success).toBe(false);
  expect(fanClaimSchema.safeParse({ ...claim, coverage: [{ kind: "native-peer", elementId: 1, ref: "1:0" }] }).success).toBe(false);
  expect(fanClaimSchema.safeParse({ kind: "to-boundary", basis: "read:1", knownInWg: 1, boundaries: [], coverage: [], blockingIds: [] }).success).toBe(false);
});
it("one new metadata row is discovered by schema, bindings and write selectors", () => {
  const extra = { ...FAN_CELLS.terminalDrops, name: "additional", segment: "additional" };
  const rows = [...FAN_INPUTS, extra];
  expect(z.strictObject(fanInputShape(rows)).partial().parse({ additional: { inWg: 1 } })).toEqual({ additional: { inWg: 1 } });
  expect(fanBindingRows(rows)).toContain(extra);
  expect(fanWriteRows(rows)).toContain(extra);
  expect(fanBindingRows()).toContain(FAN_CELLS.ratedEsp);
  expect(fanWriteRows()).not.toContain(FAN_CELLS.ratedEsp);
  for (const row of FAN_INPUTS) {
    expect(row.layers).toEqual(VALUE_SOURCES);
    if (row.role === "result") { expect(row.segment).toBeNull(); expect(row.write).toBe("never"); }
  }
});
it("complete instance cohorts contain exactly their owner and type members are unique", () => {
  const cohort = { parameter: "ESP", owner: { kind: "instance", id: 1 }, members: [{ elementId: 1, uniqueId: "one" }], basis: "read:1", complete: true };
  expect(fanParameterCohortSchema.safeParse(cohort).success).toBe(true);
  expect(fanParameterCohortSchema.safeParse({ ...cohort, members: [] }).success).toBe(false);
  expect(fanParameterCohortSchema.safeParse({ ...cohort, members: [{ elementId: 2, uniqueId: "two" }] }).success).toBe(false);
  expect(fanParameterCohortSchema.safeParse({ ...cohort, owner: { kind: "type", id: 3 }, members: [...cohort.members, ...cohort.members] }).success).toBe(false);
});

it("the Fans document's element segments are exactly the table's Fans-owned cells (P-026)", async () => {
  const { fansDocumentSchema } = await import("./fans.ts");
  const { FAN_CELLS, fanBindingRows } = await import("./fans-inputs.ts");
  const own = fanBindingRows().filter(row => row.owner === "fans").map(row => row.segment);
  // `writeIntent` is the route's scope and `calculation` its evidence; neither is an input row.
  const segments = Object.keys(fansDocumentSchema.shape).filter(key => key !== "writeIntent" && key !== "calculation");
  expect(segments.toSorted()).toEqual(own.toSorted());
  expect(Object.keys(FAN_CELLS).toSorted()).toEqual(own.toSorted());
  // A value the row's domain refuses is refused by the document, and the reverse.
  const key = "UniqueId:02d3886c-b439-49e2-9967-e703036c2c90-00000007";
  for (const [name, row] of Object.entries(FAN_CELLS))
    for (const value of [250, { inWg: 0.5 }, { role: "fan" }, "x"])
      if (name !== "terminalDrops" && name !== "componentDrops")
        expect(fansDocumentSchema.safeParse({ [name]: { [key]: { edit: { value, by: "human" } } } }).success, `${name} ${JSON.stringify(value)}`).toBe(row.accepts(value));
});
