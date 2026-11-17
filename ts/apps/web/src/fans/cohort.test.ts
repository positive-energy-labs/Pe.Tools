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
const cells = (values: Record<string, unknown>, ref?: string) => Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { edit: { value, ...(ref ? { ref } : {}) } }]));
/** Work as the host lands it: the caller stamped on each changed cell, then stored and decoded again. */
const landed = (doc: unknown, by: "human" | "pea") => fansDocumentSchema.parse(JSON.parse(JSON.stringify(stampChanges(doc, undefined, by, 4))));

test("a cohort ESP staged by Pea keeps one caller and one value on every member through Work, reload and stagedDucts", () => {
  const staged = stageEspCohort(cohort, "b1", { inWg: 0.6 });
  if ("refused" in staged) throw Error(staged.refused);
  const fans = landed({ esp: cells(staged.esp) }, "pea");
  const { esp } = stagedDucts(null, fans);
  for (const member of members)
    expect(esp[elementSubject(member)]).toEqual({ value: { inWg: 0.6 }, by: "pea", ref: `work:fans/esp/${elementSubject(member)}` });
  expect(fanWriteCells(fans, { nodes: [{ uniqueId: uid(1) }], segments: [] } as never, [cohort]).map(([, key]) => key)).toEqual(members.map(m => elementSubject(m)));
});

test("a taken default keeps its cited ref beside the caller; an unstamped legacy cell is not handed to the resolver", () => {
  const key = elementSubject({ uniqueId: uid(1) }), old = elementSubject({ uniqueId: uid(2) });
  // The caller cites the default's evidence on the cell's own `ref`; the host stamps `by` and keeps the citation.
  const human = landed({ terminalDrops: cells({ [key]: { inWg: 0.03 } }, "firm ducts.json#terminalDrop") }, "human");
  expect(fansDocumentSchema.safeParse({ flows: cells({ [old]: 100 }) }).success).toBe(false);
  // A stored legacy `{ cfm, source }` is not decoded into a number with a made-up author: the schema refuses it.
  expect(fansDocumentSchema.safeParse({ flows: cells({ [old]: { cfm: 100, source: "balancing report" } }) }).success).toBe(false);
  const design = ductsDesign(null, human);
  const { terminalDrops, flows } = stagedDucts(design, design);
  expect(terminalDrops[key]).toEqual({ value: { inWg: 0.03 }, by: "human", ref: "firm ducts.json#terminalDrop" });
  // No stamp, no caller: the cell is not handed over, and nobody is named as its author.
  expect(flows[old]).toBeUndefined();
});

const blocker = (kind: SheetBlocker["kind"], detail: string): SheetBlocker =>
  ({ id: `${kind}:9`, kind, elementId: 9, connector: 1, effectInWg: null, detail, closer: { kind: "default", note: "" } }) as SheetBlocker;
const context = { terminalDrop: null, nameOf: () => "part", wait: null, fan: { unitId: 5, name: "EF-1" } };

test("typed closers choose the cell and carry the offer's provenance; the blocker's prose decides nothing", () => {
  const offer = { value: 0.03, author: "human" as const, source: "firm" as const, ref: "ducts.json#terminalDrop", version: 3 };
  // The prose says "component"; the typed target says terminal, and wins.
  const drop = describeCloser(blocker("unknown-drop", "component 9 has no drop"), null, { ...context,
    fix: () => ({ kind: "cell", target: { work: "fans", segment: "terminalDrops", row: "r" }, offers: [offer] }) });
  expect(drop.action).toEqual({ kind: "drop", elementId: 9, value: 0.03, terminal: true, ref: "firm ducts.json#terminalDrop" });
  // The engine names the cell and offers nothing: the resolved firm default is the offer, cited as such.
  const firm = describeCloser(blocker("unknown-drop", "x"), null, { ...context, terminalDrop: { value: 0.04, source: "firm", ref: "firm:terminalDropInWg" },
    fix: () => ({ kind: "cell", target: { work: "fans", segment: "terminalDrops", row: "r" }, offers: [] }) });
  expect(firm.action).toEqual({ kind: "drop", elementId: 9, value: 0.04, terminal: true, ref: "firm firm:terminalDropInWg" });
  // The prose says "the fan's own flow"; the typed target is a terminal's flow.
  const flow = describeCloser(blocker("no-flow", "the fan's own flow into this end has no typed share"), 250, { ...context,
    fix: () => ({ kind: "cell", target: { work: "fans", segment: "flows", row: "r" }, offers: [] }) });
  expect(flow.action).toEqual({ kind: "cfm", elementId: 9, value: 250 });
  const own = describeCloser(blocker("no-flow", "this terminal has no design flow"), 250, { ...context,
    fix: () => ({ kind: "cell", target: { work: "fans", segment: "equipmentFlows", row: "r" }, offers: [] }) });
  expect(own.action).toEqual({ kind: "unitCfm", unitId: 5, value: 250 });
  // With no typed closer a flow row writes its own element, whatever the prose says and whatever the element is.
  for (const terminal of [true, false])
    expect(describeCloser(blocker("no-flow", "the fan's own flow"), 250, { ...context, terminal: () => terminal }).action).toEqual({ kind: "cfm", elementId: 9, value: 250 });
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
