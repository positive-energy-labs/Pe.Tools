import { expect, test } from "vite-plus/test";
import { fansDocumentSchema } from "@pe/agent-contracts";
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
  const cell = (value: unknown) => ({ edit: { value } });
  const doc = fansDocumentSchema.parse({
    esp: { ...Object.fromEntries(Object.entries(staged.esp).map(([k, v]) => [k, cell(v)])), [elementSubject(stranger!)]: cell({ inWg: 2 }) },
    equipmentFlows: { [elementSubject(peer!)]: cell({ cfm: 500 }) },
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
