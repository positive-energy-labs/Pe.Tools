import { detachedBridge, captureStore } from "./effect-test.ts";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { commands, type Consumed, type Command } from "@pe/agent-contracts";
import { commandCatalogAxes } from "../../../packages/agent-contracts/src/command-axes.ts";
import { commandRegistry } from "../src/command-registry.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { writeSeal } from "../src/work-write-boundary.ts";
import { ductWriteEvidence } from "@pe/ducts-domain/write-evidence";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import livePair from "./fixtures/ducts-live-seal-20261102.json" with { type: "json" };

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
const resolve = commandRegistry(detachedBridge(), captureStore("unused-seal-test"), {}, async () => { throw Error("No I/O in seal properties"); });
const writes = Object.entries(commandCatalogAxes).filter(([, axes]) => axes.effect === "ModelWrite");

test("live MUAS preview/apply seals ignore traversal diagnostics but retain model dependencies", () => {
  const preview = structuredClone(livePair.preview);
  const apply = structuredClone(preview);
  // The retained patch reconstructs the exact second capture without duplicating its entire model.
  for (const { path, value } of livePair.applyChanges) {
    let parent: any = apply;
    for (const key of path.slice(0, -1)) parent = parent[key];
    parent[path.at(-1)!] = value;
  }
  expect(apply.seal.requestHash).toBe(preview.seal.requestHash);
  expect(apply.seal.dependencies).not.toBe(preview.seal.dependencies); // The live red loop.
  const executor = resolve("ducts.apply-losses");
  const seal = (capture: typeof preview) => {
    // The 2026-11-02 capture predates the preview entry: its native input carried the retired
    // previewOnly flag, which the old projection stripped. The mode is now the op key, never input.
    const { previewOnly: _flag, ...input } = capture.value.input as Record<string, unknown>;
    // Exercise the real producer projection, which runs during acquisition before executor.seal.
    const value = {
      ...capture.value,
      input,
      dependencies: {
        ...capture.value.dependencies,
        snapshot: ductWriteEvidence(capture.value.dependencies.snapshot as unknown as DuctSnapshot),
      },
    };
    const projection = executor.seal!(value);
    return writeSeal(projection.request, capture.input, capture.work as any, capture.incarnation, capture.dependencies as Consumed[], projection.evidence);
  };
  expect(seal(apply)).toEqual(seal(preview));
  for (const mutate of [
    (v: typeof apply) => { v.value.dependencies.snapshot.nodes[0]!.connectors[0]!.point[0]! += 1; },
    (v: typeof apply) => { v.value.dependencies.snapshot.slots.fanFlow = "different-slot"; },
    (v: typeof apply) => { v.value.dependencies.snapshot.walk!.truncated = true; },
    (v: typeof apply) => { v.value.input.components[0]!.inWg += 0.01; },
  ]) {
    const changed = structuredClone(apply);
    mutate(changed);
    expect(seal(changed)).not.toEqual(seal(preview));
  }
});
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

test.each(writes)("%s preview round-trips its public response contract", async (key) => {
  const executor = resolve(key);
  const value = specimen(z.toJSONSchema(executor.sealInput!, { unrepresentable: "any" }));
  const prepared = {
    input: {},
    value,
    previewOnly: true,
    takenAt: "2026-11-02T15:17:11.675Z",
    seal: { requestHash: "request", work: {}, incarnation: {}, dependencies: "dependencies" },
  };
  const result = await executor.run(
    {
      admission: {
        target: { kind: "document", ref: { session: "test", openId: "test" } },
        input: {},
      },
    } as any,
    { prepared, step: async () => ({ previewOnly: true, results: [] }) } as any,
  );
  const definition: Command = commands[key as keyof typeof commands];
  expect(definition.result, key).toBeDefined();
  expect(definition.result!.parse(result)).toEqual(result);
});

test("captured families preparation produces a lossless preview response", async () => {
  const { default: captured } = await import("./fixtures/families-live-preview-20261102.json");
  const executor = resolve("families.apply");
  const result = await executor.run({} as any, { prepared: captured.prepared } as any);
  expect(commands["families.apply"].result.parse(result)).toEqual(result);
  expect(result).toMatchObject({
    previewOnly: true,
    seal: captured.prepared.seal,
    derivedRequest: expect.any(Array),
  });
});

test("captured successful families preview response round-trips without losing its seal", async () => {
  const { default: captured } = await import("./fixtures/families-live-preview-20261102.json");
  expect(commands["families.apply"].result.parse(captured.response)).toEqual(captured.response);
});

test.each(writes)("%s is behind the Work write boundary, keyed by its catalog axis", (key) => {
  expect(resolve(key).boundary).toBe("work");
});
