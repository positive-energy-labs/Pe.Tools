import { expect, test } from "vite-plus/test";
import { ductsDocumentSchema, fansDocumentSchema, stagedDucts } from "@pe/agent-contracts";
import { editPatches } from "./sheet/edits.ts";
import { resolveCriteria } from "./sheet/inputs.ts";
import { TEST_FIRM } from "./sheet/test-inputs.ts";
import { fanWriteCells, stageEspCohort } from "./staged.ts";
import { elementSubject } from "./work-subject.ts";

const uid = (n: number) => `3f2c9a10-0000-4000-8000-00000000000${n}-0001e240`;
const [onWalk, peer, stranger] = [1, 2, 3].map(n => ({ elementId: n, uniqueId: uid(n) }));
const snapshot = { nodes: [{ uniqueId: onWalk!.uniqueId }], segments: [] } as unknown as Parameters<typeof fanWriteCells>[1];
const cohort = { parameter: "fanStatic", owner: { kind: "type" as const, id: 77 }, members: [onWalk!, peer!], basis: "b1", complete: true };

test("a complete cohort stages one value on every member, and only its off-walk members join the write scope", () => {
  const staged = stageEspCohort(cohort, "b1", { inWg: 0.75 });
  if ("refused" in staged) throw Error(staged.refused);
  expect(staged.esp).toEqual({ [elementSubject(onWalk!)]: { inWg: 0.75 }, [elementSubject(peer!)]: { inWg: 0.75 } });
  const cell = (value: unknown) => ({ edit: { value, by: "human" } });
  const doc = fansDocumentSchema.parse({
    esp: { ...Object.fromEntries(Object.entries(staged.esp).map(([k, v]) => [k, cell(v)])), [elementSubject(stranger!)]: cell({ inWg: 2 }) },
    equipmentFlows: { [elementSubject(peer!)]: cell(500) },
  });
  // Without native membership the walk still clips: nothing off it is written.
  expect(fanWriteCells(doc, snapshot)).toEqual([["esp", elementSubject(onWalk!)]]);
  // With it, the peer's ESP alone joins; its other cells and an unrelated unit's edit stay out.
  expect(fanWriteCells(doc, snapshot, [cohort])).toEqual([["esp", elementSubject(onWalk!)], ["esp", elementSubject(peer!)]]);
  // A cohort with no member on this walk, or an incomplete one, widens nothing.
  expect(fanWriteCells(doc, snapshot, [{ ...cohort, members: [peer!, stranger!] }, { ...cohort, complete: false, members: [onWalk!, stranger!] }])).toHaveLength(1);
});

test("an incomplete, stale or misowned cohort refuses and stages nothing", () => {
  expect(stageEspCohort({ ...cohort, complete: false }, "b1", { inWg: 1 })).toHaveProperty("refused");
  expect(stageEspCohort(cohort, "b2", { inWg: 1 })).toHaveProperty("refused");
  expect(stageEspCohort({ ...cohort, owner: { kind: "instance", id: 1 } }, "b1", { inWg: 1 })).toHaveProperty("refused");
  expect(stageEspCohort({ ...cohort, members: [] }, "b1", { inWg: 1 })).toHaveProperty("refused");
  expect(stageEspCohort({ ...cohort, owner: { kind: "instance", id: 1 }, members: [onWalk!] }, "b1", { inWg: 1 })).toHaveProperty("esp");
});

test("stagedDucts never invents a caller for an unstamped cell, and locates uncited evidence", () => {
  const key = elementSubject(onWalk!), other = elementSubject(peer!);
  // Deliberately bypass storage decoding to challenge stagedDucts' own boundary.
  const raw = { flows: { [key]: { edit: { value: 250 } }, [other]: { edit: { value: 90, by: "human" } } } };
  const fans = { ...fansDocumentSchema.parse({}), ...raw } as Parameters<typeof stagedDucts>[1];
  expect(stagedDucts(null, fans).flows).toEqual({
    [other]: { value: 90, by: "human", ref: `work:fans/flows/${other}` },
  });
});

test("stagedDucts hands the resolver { value, by, ref } cells: airflow a plain number, a cited ref kept, else the cell's location, and no unstamped cell", () => {
  const key = elementSubject(onWalk!), other = elementSubject(peer!);
  const fans = fansDocumentSchema.parse({
    flows: { [key]: { edit: { value: 250, by: "pea", ref: "balancing report p2" } }, [other]: {} },
    esp: { [key]: { edit: { value: { inWg: 0.5 }, by: "human" } }, [other]: {} },
  });
  const staged = stagedDucts(null, fans);
  expect(staged.flows).toEqual({
    [key]: { value: 250, by: "pea", ref: "balancing report p2" },
  });
  expect(staged.esp).toEqual({ [key]: { value: { inWg: 0.5 }, by: "human", ref: `work:fans/esp/${key}` } });
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
