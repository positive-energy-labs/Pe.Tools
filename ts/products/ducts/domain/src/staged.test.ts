import { nodeOf } from "./test-snapshot.ts";
import { expect, test } from "vite-plus/test";
import { ductsDocumentSchema, fansDocumentSchema, stagedDucts } from "@pe/agent-contracts";
import { editPatches } from "./calc/edits.ts";
import { resolveCriteria } from "./calc/inputs.ts";
import { TEST_FIRM } from "./test-inputs.ts";
import { elementSubject } from "./work-subject.ts";
import { fanWriteCells } from "./staged.ts";

const uid = (n: number) => `3f2c9a10-0000-4000-8000-00000000000${n}-0001e240`;
const [onWalk, peer] = [1, 2].map(n => ({ elementId: n, uniqueId: uid(n) }));

test("fan Work writes clip every segment to the walk; required ESP has no staged cell", () => {
  const doc = fansDocumentSchema.parse({ equipmentFlows: Object.fromEntries([onWalk!, peer!].map(n => [elementSubject(n), { edit: { by: "human", value: 200 } }])) });
  const snapshot = { nodes: [nodeOf(1, "equipment", { uniqueId: onWalk!.uniqueId })], segments: [] };
  expect(fanWriteCells(doc, snapshot)).toEqual([["equipmentFlows", elementSubject(onWalk!)]]);
  expect(fansDocumentSchema.safeParse({ esp: {} }).success).toBe(false);
});

test("stagedDucts never invents a caller for an unstamped cell, and locates uncited evidence", () => {
  const key = elementSubject(onWalk!), other = elementSubject(peer!);
  // Deliberately bypass storage decoding to challenge stagedDucts' own boundary.
  const raw = { flows: { [key]: { edit: { value: 250 } }, [other]: { edit: { value: 90, by: "human" } } } };
  const fans = Object.assign(fansDocumentSchema.parse({}), raw);
  expect(stagedDucts(null, fans).flows).toEqual({
    [other]: { value: 90, by: "human", ref: `work:fans/flows/${other}` },
  });
});

test("stagedDucts hands the resolver { value, by, ref } cells: airflow a plain number, a cited ref kept, else the cell's location, and no unstamped cell", () => {
  const key = elementSubject(onWalk!), other = elementSubject(peer!);
  const fans = fansDocumentSchema.parse({
    flows: { [key]: { edit: { value: 250, by: "pea", ref: "balancing report p2" } }, [other]: {} },
    ratedEsp: { [key]: { edit: { value: { inWg: 0.5 }, by: "human" } }, [other]: {} },
  });
  const staged = stagedDucts(null, fans);
  expect(staged.flows).toEqual({
    [key]: { value: 250, by: "pea", ref: "balancing report p2" },
  });
  expect(staged.ratedEsp).toEqual({ [key]: { value: { inWg: 0.5 }, by: "human", ref: `work:fans/ratedEsp/${key}` } });
});

test("a staged criterion resolves from Work with the caller who staged it and the ref they cited", () => {
  const ducts = ductsDocumentSchema.parse({ criteria: { terminalDropInWg: { edit: { value: 0.07, by: "pea", ref: "spec 23 37 13" } } } });
  const { criteria, criteriaMeta } = stagedDucts(ducts, fansDocumentSchema.parse({}));
  expect(resolveCriteria({ criteria, criteriaMeta }, null, TEST_FIRM).terminalDropInWg)
    .toMatchObject({ status: "valid", value: 0.07, source: "Work", author: "pea", ref: "spec 23 37 13" });
  // Unstamped stored Work is refused at decoding, before it reaches the resolver.
  expect(ductsDocumentSchema.safeParse({ criteria: { terminalDropInWg: { edit: { value: 0.07 } } } }).success).toBe(false);
});

test("a sheet edit's cited ref lands on the cell it cites, and airflow is a plain number", () => {
  const key = elementSubject(onWalk!), other = elementSubject(peer!);
  expect(editPatches({ flows: { [key]: 250 }, terminalDrops: { [key]: { inWg: 0.03 }, [other]: { inWg: 0.1 } },
    refs: { terminalDrops: { [key]: "firm ducts.json#terminalDrop" } } })).toEqual([
    { path: ["flows", key, "edit"], value: { value: 250 } },
    { path: ["terminalDrops", key, "edit"], value: { value: { inWg: 0.03 }, ref: "firm ducts.json#terminalDrop" } },
    { path: ["terminalDrops", other, "edit"], value: { value: { inWg: 0.1 } } },
  ]);
});
