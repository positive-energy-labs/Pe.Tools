import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { commands, type Consumed } from "@pe/agent-contracts";
import { commandCatalogAxes } from "../../../packages/agent-contracts/src/command-axes.ts";
import { commandRegistry } from "../src/command-registry.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import type { RevitBridge } from "../src/bridge.ts";
import { writeSeal } from "../src/work-write-boundary.ts";

// Structural specimens exercise each real producer projection without acquiring a native session.
function specimen(schema: any, root = schema, depth = 0): any {
  if (depth > 14) return null;
  if (schema.$ref) return specimen(schema.$ref.split("/").slice(1).reduce((v: any, k: string) => v[k], root), root, depth + 1);
  if ("const" in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf || schema.oneOf) return specimen((schema.anyOf ?? schema.oneOf).find((s: any) => s.type !== "null"), root, depth + 1);
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s: any) => specimen(s, root, depth + 1)));
  if (schema.type === "object") return Object.fromEntries(Object.entries(schema.properties ?? (schema.additionalProperties ? { a: schema.additionalProperties, b: schema.additionalProperties } : {})).map(([k, s]) => [k, specimen(s, root, depth + 1)]));
  if (schema.type === "array") return [specimen(schema.items ?? {}, root, depth + 1), specimen(schema.items ?? {}, root, depth + 1)];
  if (schema.type === "string") return "fact";
  if (schema.type === "number" || schema.type === "integer") return 1;
  if (schema.type === "boolean") return true;
  return { semanticFact: 1 };
}
function reorder(value: any): any {
  if (Array.isArray(value)) return value.map(reorder); // Request sequences must remain ordered.
  return value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reorder(v)])) : value;
}
const resolve = commandRegistry({} as RevitBridge["Service"], new TakeoffCaptures("unused-seal-test"), {}, async () => { throw Error("No I/O in seal properties"); });
const writes = Object.entries(commandCatalogAxes).filter(([, axes]) => axes.effect === "ModelWrite");
test.each(writes)("%s seals semantic evidence across permutation/refetch", (key) => {
  expect(commands).toHaveProperty(key);
  const executor = resolve(key);
  expect(executor.seal, `${key} has no producer projection`).toBeTypeOf("function");
  expect(executor.sealInput, `${key} has no typed producer input`).toBeDefined();
  const raw = specimen(z.toJSONSchema(executor.sealInput!, { unrepresentable: "any" }));
  const work = { key: { binding: "open" as const, route: key, target: null, open: { session: "A", openId: "doc" } }, revision: 1 };
  const consumed: Consumed[] = [
    { kind: "file", probe: { path: "a" }, expected: "1" },
    { kind: "work", probe: { handle: work, paths: [["a"], ["b"]], edits: [["a"], ["b"]] }, expected: { a: 1 } },
  ];
  const seal = (p: unknown, dependencies = consumed, handle = work, intent: unknown = { a: 1 }, incarnation: unknown = { openId: "doc" }) => {
    const projection = executor.seal!(p);
    return writeSeal(projection.request, intent, handle, incarnation, dependencies, projection.evidence);
  };
  const baseline = seal(raw);
  for (let seed = 0; seed < 32; seed++) {
    const refetch = reorder(structuredClone(raw));
    Object.assign(refetch, { at: `refetch-${seed}`, readbackTakenAt: `refetch-${seed}`, elapsedMs: seed, newDiagnostic: seed });
    if (refetch.reading) Object.assign(refetch.reading, { capturedAt: `refetch-${seed}` });
    const dependencies = structuredClone(consumed);
    const selected = dependencies[1] as Extract<Consumed, { kind: "work" }>;
    if (seed % 2) selected.probe.paths.reverse();
    if (seed % 3) selected.probe.edits?.reverse();
    if (seed % 5) dependencies.reverse();
    dependencies.push(structuredClone(dependencies[0]!));
    expect(seal(refetch, dependencies)).toEqual(baseline);
  }
  expect(seal(raw, consumed, { ...work, revision: 2 })).not.toEqual(baseline);
  expect(seal(raw, consumed, work, { a: 2 })).not.toEqual(baseline);
  expect(seal(raw, consumed, work, undefined, { openId: "reopened" })).not.toEqual(baseline);
  const changed = structuredClone(consumed);
  changed[0]!.expected = "changed";
  expect(seal(raw, changed)).not.toEqual(baseline);
  const mutations = (value: any): any[] => {
    if (value === null || typeof value !== "object") return [typeof value === "number" ? value + 1 : typeof value === "boolean" ? !value : `${value}-changed`];
    return Object.keys(value).flatMap(k => mutations(value[k]).map(changed => {
      const next = structuredClone(value); next[k] = changed; return next;
    }));
  };
  expect(mutations(raw).some(changed => JSON.stringify(executor.seal!(changed)) !== JSON.stringify(executor.seal!(raw))), `${key}: projection dropped every semantic fact`).toBe(true);
  const p = executor.seal!(raw);
  expect(writeSeal([p.request, "a"], {}, work, {}, [], p.evidence)).not.toEqual(writeSeal(["a", p.request], {}, work, {}, [], p.evidence));
});
