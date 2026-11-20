import { expect, it } from "vite-plus/test";
import { z } from "zod";
import {
  authoredValueSchema,
  fanClaimSchema,
  fanIssueSchema,
  fanParameterCohortSchema,
  sourcedValueSchema,
} from "./fans-inputs.ts";
import { resolveValue } from "@pe/agent-contracts/work-value";
import { DUCT_UNIT_KINDS, FAN_BLOCKER_KINDS } from "@pe/host-contracts/generated";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { draftEditSchema } from "../../../../packages/agent-contracts/src/draft.ts";
import { product, fansCalcEditsSchema, fanWriteSegments } from "./product.ts";
import { sheetCells } from "@pe/agent-contracts/product";
import { schemaOf } from "@pe/agent-contracts/slots/sheet";
import { fansDocumentSchema } from "./fans.ts";
import { subjectCode, uniqueIdSchema } from "@pe/agent-contracts/subject-ref";

it("airflow is a plain number with caller-cited cell evidence, and legacy objects are refused", () => {
  expect(fansDocumentSchema.safeParse({ calculation: {} }).success).toBe(false);
  const key = subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("fixture:1") });
  for (const segment of ["flows", "equipmentFlows"]) {
    const doc = {
      [segment]: { [key]: { edit: { value: 250, ref: "submittal:page-2", by: "pea" } } },
    };
    expect(fansDocumentSchema.parse(doc)).toMatchObject(doc);
    expect(
      fansDocumentSchema.safeParse({
        [segment]: { [key]: { edit: { value: { cfm: 250, source: "legacy" } } } },
      }).success,
    ).toBe(false);
  }
  const cell = z.strictObject({ edit: draftEditSchema(z.number()) });
  expect(cell.parse({ edit: { value: 250, ref: "submittal:page-2" } })).toEqual({
    edit: { value: 250, ref: "submittal:page-2" },
  });
  for (const ref of ["", " "])
    expect(cell.safeParse({ edit: { value: 250, ref } }).success).toBe(false);
});

it("decoder words are exactly the native snapshot catalog vocabulary", () => {
  const definitions = JSON.parse(
    hostOpCatalog.find((op) => op.key === "ducts.snapshot.walk")!.responseSchemaJson,
  ).definitions;
  expect(DUCT_UNIT_KINDS).toEqual(definitions.DuctUnitKind.enum);
  expect(FAN_BLOCKER_KINDS).toEqual(definitions.FanBlockerKind.enum);
});

const value = {
  status: "valid",
  value: 1,
  source: "Work",
  author: "human",
  ref: "submittal:fan-1",
  version: 2,
  units: "in-wg",
};
it("accepts a backflow blocker on the wire", () => {
  const blocker = {
    id: "backflow:1",
    kind: "backflow",
    elementId: 1,
    severity: "blocking",
    closer: { kind: "none", reason: "Reverse flow requires a ruling" },
  };
  expect(fanIssueSchema.parse(blocker)).toEqual(blocker);
  expect(
    fanIssueSchema.parse({ ...blocker, kind: "direction-mismatch", severity: "warning" }).kind,
  ).toBe("direction-mismatch");
});
it("requires evidence and authentic caller identity for valid staged values", () => {
  const schema = sourcedValueSchema(z.number().nonnegative());
  expect(schema.parse(value)).toEqual(value);
  for (const author of [null, "unknown"])
    expect(schema.safeParse({ ...value, author }).success).toBe(false);
  expect(schema.safeParse({ ...value, ref: " " }).success).toBe(false);
  expect(schema.safeParse({ ...value, source: "model", author: null }).success).toBe(true);
  expect(schema.safeParse({ ...value, status: "invalid", value: null, author: null }).success).toBe(
    true,
  );
  expect(
    schema.safeParse({
      ...value,
      status: "missing",
      source: "none",
      value: null,
      author: null,
      ref: null,
      version: null,
    }).success,
  ).toBe(true);
  expect(
    authoredValueSchema(z.number()).safeParse({
      value: 1,
      source: "run",
      author: "unknown",
      ref: "run:1",
      version: null,
    }).success,
  ).toBe(false);
  expect(
    resolveValue(
      {
        Work: { value: -1, author: "pea", ref: "Work:1" },
        model: { value: 2, author: null, ref: "model:1" },
      },
      null,
      (n) => n >= 0,
    ),
  ).toMatchObject({ value: null, status: "invalid", source: "Work", author: "pea", ref: "Work:1" });
});
it("a complete claim refuses pressure, coverage or blocking damage", () => {
  const claim = {
    kind: "complete",
    basis: "read:1",
    requiredEspInWg: 1,
    coverage: [],
    blockingIds: [],
  };
  expect(fanClaimSchema.safeParse(claim).success).toBe(true);
  for (const requiredEspInWg of [-1, Infinity, NaN])
    expect(fanClaimSchema.safeParse({ ...claim, requiredEspInWg }).success).toBe(false);
  expect(fanClaimSchema.safeParse({ ...claim, blockingIds: ["no-flow:1"] }).success).toBe(false);
  expect(
    fanClaimSchema.safeParse({
      ...claim,
      coverage: [{ kind: "native-peer", elementId: 1, ref: "1:0" }],
    }).success,
  ).toBe(false);
  expect(
    fanClaimSchema.safeParse({
      kind: "to-boundary",
      basis: "read:1",
      knownInWg: 1,
      boundaries: [],
      coverage: [],
      blockingIds: [],
    }).success,
  ).toBe(false);
});
it("complete instance cohorts contain exactly their owner and type members are unique", () => {
  const cohort = {
    parameter: "ESP",
    owner: { kind: "instance", id: 1 },
    members: [{ elementId: 1, uniqueId: "one" }],
    basis: "read:1",
    complete: true,
  };
  expect(fanParameterCohortSchema.safeParse(cohort).success).toBe(true);
  expect(fanParameterCohortSchema.safeParse({ ...cohort, members: [] }).success).toBe(false);
  expect(
    fanParameterCohortSchema.safeParse({ ...cohort, members: [{ elementId: 2, uniqueId: "two" }] })
      .success,
  ).toBe(false);
  expect(
    fanParameterCohortSchema.safeParse({
      ...cohort,
      owner: { kind: "type", id: 3 },
      members: [...cohort.members, ...cohort.members],
    }).success,
  ).toBe(false);
});

it("Work, sheet bindings, and edit admission share the declared cells", () => {
  expect(Object.keys(fansDocumentSchema.shape)).toEqual(Object.keys(sheetCells(product)));
  expect(fanWriteSegments).not.toContain("ratedEsp");
  expect(fansCalcEditsSchema.safeParse({ esp: {} }).success).toBe(false);
  for (const [name, { per, domain }] of Object.entries(product.cells)) {
    if (per !== "subject") continue;
    const key = "UniqueId:02d3886c-b439-49e2-9967-e703036c2c90-00000007";
    for (const value of [250, { inWg: 0.5 }, { role: "fan" }, "x"]) {
      const accepted = schemaOf(domain).safeParse(value).success;
      expect(
        fansDocumentSchema.safeParse({ [name]: { [key]: { edit: { value, by: "human" } } } })
          .success,
      ).toBe(accepted);
      expect(fansCalcEditsSchema.safeParse({ [name]: { [key]: value } }).success).toBe(accepted);
    }
  }
});
