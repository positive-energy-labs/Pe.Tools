import { expect, test } from "vite-plus/test";
import { ductsDesign, fansDocumentSchema, stagedDucts, stampChanges } from "@pe/agent-contracts";
import { fanWriteCells, stageEspCohort } from "@pe/ducts-domain/staged";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { describeCloser } from "../ducts/sheet/closer";
import type { SheetBlocker } from "../ducts/sheet/tiers";
import { espWarnings } from "./picture.tsx";

const uid = (n: number) => `3f2c9a10-0000-4000-8000-00000000000${n}-0001e240`;
const members = [1, 2].map(n => ({ elementId: n, uniqueId: uid(n) }));
const cohort = { parameter: "fanStatic", owner: { kind: "type" as const, id: 9 }, members, basis: "b1", complete: true };
const cells = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { edit: { value } }]));
/** Work as the host lands it: the caller stamped on each changed cell, then stored and decoded again. */
const landed = (doc: unknown, by: "human" | "pea") => fansDocumentSchema.parse(JSON.parse(JSON.stringify(stampChanges(doc, undefined, by, 4))));

test("a cohort ESP staged by Pea keeps one caller and one value on every member through Work, reload and stagedDucts", () => {
  const staged = stageEspCohort(cohort, "b1", { inWg: 0.6 });
  if ("refused" in staged) throw Error(staged.refused);
  const fans = landed({ esp: cells(staged.esp) }, "pea");
  const { esp, authored } = stagedDucts(null, fans);
  for (const member of members) {
    expect(esp[elementSubject(member)]).toEqual({ inWg: 0.6 });
    expect(authored.esp[elementSubject(member)]).toMatchObject({ value: { inWg: 0.6 }, author: "pea", source: "Work", version: 4 });
  }
  expect(fanWriteCells(fans, { nodes: [{ uniqueId: uid(1) }], segments: [] } as never, [cohort]).map(([, key]) => key)).toEqual(members.map(m => elementSubject(m)));
});

test("a taken default keeps its original source and ref beside the caller; an unstamped legacy cell stays unknown", () => {
  const key = elementSubject({ uniqueId: uid(1) }), old = elementSubject({ uniqueId: uid(2) });
  const human = landed({ terminalDrops: cells({ [key]: { inWg: 0.03, source: "firm ducts.json#terminalDrop" } }) }, "human");
  const legacy = fansDocumentSchema.parse({ flows: cells({ [old]: { cfm: 100 } }) });
  const design = ductsDesign(null, { ...human, flows: legacy.flows });
  const { authored, terminalDrops } = stagedDucts(design, design);
  expect(terminalDrops[key]).toEqual({ inWg: 0.03, source: "firm ducts.json#terminalDrop" });
  expect(authored.terminalDrops[key]).toMatchObject({ author: "human", source: "Work", ref: "firm ducts.json#terminalDrop" });
  expect(authored.flows[old]).toMatchObject({ author: "unknown", ref: `flows/${old}`, version: null });
});

const blocker = (kind: SheetBlocker["kind"], detail: string): SheetBlocker =>
  ({ id: `${kind}:9`, kind, elementId: 9, connector: 1, effectInWg: null, detail, closer: { kind: "default", note: "" } }) as SheetBlocker;
const context = { terminalDrop: null, nameOf: () => "part", wait: null, fan: { unitId: 5, name: "EF-1" } };

test("typed closers choose the cell and carry the offer's provenance; the blocker's prose decides nothing", () => {
  const offer = { value: 0.03, author: "unknown" as const, source: "firm" as const, ref: "ducts.json#terminalDrop", version: 3 };
  // The prose says "component"; the typed target says terminal, and wins.
  const drop = describeCloser(blocker("unknown-drop", "component 9 has no drop"), null, { ...context,
    fix: () => ({ kind: "cell", target: { work: "fans", segment: "terminalDrops", row: "r" }, offers: [offer] }) });
  expect(drop.action).toEqual({ kind: "drop", elementId: 9, value: 0.03, terminal: true, source: "firm ducts.json#terminalDrop" });
  // The prose says "the fan's own flow"; the typed target is a terminal's flow.
  const flow = describeCloser(blocker("no-flow", "the fan's own flow into this end has no typed share"), 250, { ...context,
    fix: () => ({ kind: "cell", target: { work: "fans", segment: "flows", row: "r" }, offers: [] }) });
  expect(flow.action).toEqual({ kind: "cfm", elementId: 9, value: 250 });
  const own = describeCloser(blocker("no-flow", "this terminal has no design flow"), 250, { ...context,
    fix: () => ({ kind: "cell", target: { work: "fans", segment: "equipmentFlows", row: "r" }, offers: [] }) });
  expect(own.action).toEqual({ kind: "unitCfm", unitId: 5, value: 250 });
  // With no typed closer the walk's own terminals decide, still not the prose.
  expect(describeCloser(blocker("no-flow", "the fan's own flow"), 250, { ...context, terminal: () => true }).action).toMatchObject({ kind: "cfm" });
  expect(describeCloser(blocker("unknown-drop", "terminal 9"), 0.1, { ...context, terminal: () => false }).action).toMatchObject({ terminal: false });
});

test("rated, required and staged ESP are three facts: a partial claim is named partial, a short rating and a drifted stage warn", () => {
  const value = (v: number, source: "model" | "Work" = "model") => ({ status: "valid" as const, value: v, source, author: source === "Work" ? "human" as const : null, ref: "r", version: null, units: "in-wg" });
  const missing = { status: "missing" as const, value: null, source: "none" as const, author: null, ref: null, version: null, units: "in-wg" };
  const complete = { kind: "complete" as const, basis: "b", requiredEspInWg: 0.8, coverage: [] as const, blockingIds: [] as const };
  expect(espWarnings({ rated: value(0.8), required: complete, staged: missing })).toEqual([]);
  expect(espWarnings({ rated: value(0.5), required: complete, staged: value(0.6, "Work") })).toEqual([
    "Rated ESP 0.50 in-wg is below the required 0.80 in-wg", "Staged ESP 0.60 in-wg differs from the required 0.80 in-wg"]);
  const partial = espWarnings({ rated: value(2), staged: missing, required: { kind: "incomplete", basis: "b", knownInWg: 0.3, coverage: [{ kind: "pricing", elementId: 4, ref: "x" }], blockingIds: ["no-flow:4"] } });
  expect(partial).toEqual(["Required ESP is not known: 1 coverage gap, 1 blocking; 0.30 in-wg so far"]);
});
