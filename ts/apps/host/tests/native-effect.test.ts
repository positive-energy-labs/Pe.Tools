import { describe, expect, it } from "vite-plus/test";
import { Schema } from "effect";
import { createJiti } from "jiti";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { emitSchema, generateNativeEffect, nativeEffectPrelude, schemaCode } from "../../../packages/host-contracts/scripts/native-effect-generator.ts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { nativeEffectSchemas, nativeEffectResponseDefinitions } from "../../../packages/host-contracts/src/generated/native-effect.generated.ts";
import { nativeRecordings, nativeRecordingRequest } from "./native-recordings.ts";

const jiti = createJiti(import.meta.url);
async function generatedModule(input: Record<string, any>, definitions = false, witness = "") {
  const dir = mkdtempSync(resolve(import.meta.dirname, ".native-effect-test-"));
  const file = resolve(dir, "generated.ts");
  writeFileSync(file, nativeEffectPrelude + emitSchema(input, "Test", definitions) + witness);
  try {
    if (definitions || witness) {
      const program = ts.createProgram([file], { noEmit: true, strict: true, exactOptionalPropertyTypes: true, skipLibCheck: true, types: ["node"], module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ESNext });
      expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
    }
    return (await jiti.import<{ Test: { decoder: Schema.Decoder<unknown>; definitions: Record<string, Schema.Decoder<unknown>> } }>(file)).Test;
  }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
async function generated(input: Record<string, any>) { return (await generatedModule(input)).decoder; }

describe("C# native Effect projection", () => {
  it.each([
    { name: "Wire", root: false }, { name: "Value", root: false },
    { name: "Wire", root: true }, { name: "Value", root: true },
  ])("compiles public aliases beside upstream $name references with root=$root", async ({ name, root }) => {
    const other = name === "Wire" ? "Value" : "Wire";
    const definitions = {
      [name]: { type: "object", additionalProperties: false, properties: { count: { $ref: `#/$defs/${other}` }, next: { $ref: `#/$defs/${name}` } } },
      [other]: { type: "integer", default: 7 },
      Root: { $ref: "#/$defs/Root_" }, Root_: { type: "integer", default: 8 },
      WireTypes: { $ref: "#/$defs/Root" }, Decoded: { type: "string", enum: ["local"] },
    };
    const made = await generatedModule({ $schema: "https://json-schema.org/draft/2020-12/schema", $defs: definitions,
      ...(root ? { $ref: `#/$defs/${name}` } : { title: other, type: "object", additionalProperties: false,
        properties: { node: { $ref: `#/$defs/${name}` }, alias: { $ref: "#/$defs/WireTypes" }, label: { $ref: "#/$defs/Decoded" } } }),
    }, true, `
const wire: Test.Wire = ${root ? "{ next: {} }" : "{ node: { next: {} } }"};
const value: Test.Value = ${root ? "{ count: 7, next: { count: 7 } }" : "{ alias: 8, node: { count: 7, next: { count: 7 } } }"};
// @ts-expect-error populated decoded defaults cannot be omitted
const missing: Test.Value = ${root ? "{ next: {} }" : "{ alias: 8, node: { next: {} } }"};
function privateAndOpaque() {
  // @ts-expect-error decoded structural scope is private
  Test.Decoded;
  // @ts-expect-error public root remains one-way
  Schema.encodeSync(Test.decoder);
}
`);
    const input = root ? { next: {} } : { node: { next: {} } };
    expect(Schema.decodeUnknownSync(made.decoder)(input)).toEqual(root ? { count: 7, next: { count: 7 } } : { alias: 8, node: { count: 7, next: { count: 7 } } });
    expect(Schema.decodeUnknownSync(made.definitions[other])(7)).toBe(7);
    expect(Schema.decodeUnknownSync(made.definitions.WireTypes)(8)).toBe(8);
  });
  it("separates recursive alias/default/nullable Wire authoring from populated Value", async () => {
    expect(Schema.decodeUnknownSync(nativeEffectSchemas["revit.resolve.family-instances"].request)({ familyId: 1, familyUniqueId: "family" })).toEqual({ familyId: 1, familyUniqueId: "family", maxResults: 500 });
    const made = await generatedModule({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false,
      properties: { node: { $ref: "#/$defs/Node" }, nullable: { type: ["integer", "null"], default: null } },
      $defs: { Node: { type: "object", additionalProperties: false, properties: { count: { $ref: "#/$defs/Alias" }, next: { $ref: "#/$defs/Node" } } }, Alias: { $ref: "#/$defs/Count" }, Count: { type: "integer", default: 8 } },
    }, true, `
const wire: Test.Wire = { node: { next: {} } };
const nullable: Test.Wire = { nullable: null };
const value: Test.Value = { nullable: null, node: { count: 8, next: { count: 8 } } };
// @ts-expect-error decoded root default must be populated
const missingRoot: Test.Value = {};
// @ts-expect-error recursive decoded child default must be populated
const missingChild: Test.Value = { nullable: null, node: { count: 8, next: {} } };
// @ts-expect-error an absent wire key is not explicit undefined
const undefinedKey: Test.Wire = { nullable: undefined };
`);
    const decode = Schema.decodeUnknownSync(made.decoder);
    expect(decode({ node: { next: {} } })).toEqual({ nullable: null, node: { count: 8, next: { count: 8 } } });
    expect(() => decode({ nullable: undefined })).toThrow();
  });
  it("composes both image deliveries without exposing paths or losing native disclosure", () => {
    const recording = nativeRecordings("retained-view-image").responses["revit.context.view-image"];
    const receipt = Schema.Struct({ sha: Schema.String });
    for (const key of ["revit.context.view-image", "revit.context.view-image.focus"] as const) {
      const raw = Schema.decodeUnknownSync(nativeEffectSchemas[key].response)(recording);
      const { filePath: _, imageUrl: __, ...native } = raw;
      const delivery = nativeEffectSchemas[key].delivery(receipt);
      const decode = Schema.decodeUnknownSync(delivery);
      const delivered = { ...native, capture: { sha: "asset" }, imageUrl: "/captures/asset.png" };
      expect(decode(delivered)).toEqual(delivered);
      expect(decode({ ...native, refused: true, capture: null, imageUrl: null })).toEqual({ ...native, refused: true, capture: null, imageUrl: null });
      for (const invalid of [{ ...delivered, filePath: "private.png" }, { ...delivered, extra: true }, { ...delivered, capture: {} }, { ...delivered, imageUrl: undefined }, { ...delivered, width: 2147483648 }, { ...delivered, marks: [{ elementId: 9007199254740992, left: 0, top: 0, width: 1, height: 1 }] }])
        expect(() => decode(invalid, { onExcessProperty: "ignore" })).toThrow();
      const composed = Schema.Struct({ optional: Schema.optionalKey(delivery), rows: Schema.Array(delivery) });
      expect(Schema.decodeUnknownSync(composed)({ rows: [delivered] })).toEqual({ rows: [delivered] });
    }
  });
  it("refuses image delivery source drift and root checks with operation provenance", () => {
    for (const key of ["revit.context.view-image", "revit.context.view-image.focus"]) {
      const source = JSON.parse(hostOpCatalog.find(op => op.key === key)!.responseSchemaJson);
      const compile = (response: object) => generateNativeEffect([{ key, requestSchemaJson: "{}", responseSchemaJson: JSON.stringify(response) }]);
      for (const field of ["filePath", "imageUrl"]) {
        const missing = structuredClone(source);
        delete missing.properties[field];
        expect(() => compile(missing)).toThrow(`${key}/response: Error: #/delivery/${field}`);
        const changed = structuredClone(source);
        changed.properties[field] = { type: "integer" };
        expect(() => compile(changed)).toThrow(`${key}/response: Error: #/delivery/${field}`);
      }
      // This importer subset refuses object-cardinality checks before mapFields can drop them.
      expect(() => compile({ ...source, minProperties: 1 })).toThrow(`${key}/response: Error: #: unsupported keyword minProperties`);
      const { $schema: _, definitions, ...branch } = source;
      expect(() => compile({ $schema: source.$schema, definitions, anyOf: [branch, { type: "null" }] })).toThrow(`${key}/response: Error: #/delivery`);
    }
  });
  it("emits definition roots with recursion, defaults, false and escaped source keys", async () => {
    const definitions = Object.fromEntries([
      ["Node", { type: "object", additionalProperties: false, properties: { value: { type: "integer" }, count: { $ref: "#/$defs/Count" }, next: { $ref: "#/$defs/Node" } }, required: ["value"] }],
      ["Count", { type: "integer", default: 8 }], ["Alias", { $ref: "#/$defs/Count" }], ["Blocked", false],
      ["A/B~C", { type: "string", enum: ["escaped"] }], ["A-B", { type: "integer", minimum: 10 }],
      ["A_B", { type: "string", enum: ["distinct"] }], ["__proto__", { type: "boolean" }],
    ]);
    const made = await generatedModule({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { node: { $ref: "#/$defs/Node" } }, additionalProperties: false, $defs: definitions }, true);
    expect(Object.keys(made.definitions)).toEqual(Object.keys(definitions).sort());
    const decode = (key: string, value: unknown) => Schema.decodeUnknownSync(made.definitions[key])(value);
    expect(decode("Node", { value: 1, next: { value: 2 } })).toEqual({ value: 1, count: 8, next: { value: 2, count: 8 } });
    expect(decode("Alias", 8)).toBe(8);
    expect(() => decode("Blocked", 1)).toThrow();
    expect(decode("A/B~C", "escaped")).toBe("escaped");
    expect(decode("A-B", 10)).toBe(10);
    expect(() => decode("A-B", "distinct")).toThrow();
    expect(decode("A_B", "distinct")).toBe("distinct");
    expect(decode("__proto__", true)).toBe(true);
    expect(Object.hasOwn(made.definitions, "__proto__")).toBe(true);
    const composed = Schema.Struct({ optional: Schema.optionalKey(made.definitions.Node), rows: Schema.Array(made.definitions.Node) });
    expect(Schema.decodeUnknownSync(composed)({ rows: [{ value: 3 }] })).toEqual({ rows: [{ value: 3, count: 8 }] });
    expect(() => Schema.decodeUnknownSync(composed)({ rows: [{ value: 3, extra: true }] }, { onExcessProperty: "ignore" })).toThrow();
  });
  it("keeps same-named definition contracts in separate operation documents", async () => {
    const dir = mkdtempSync(resolve(import.meta.dirname, ".native-effect-test-"));
    const file = resolve(dir, "operations.ts");
    const operations = [1, 10].map(minimum => ({ key: `op${minimum}`, requestSchemaJson: JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", $ref: "#/$defs/Same", $defs: { Same: { type: "integer", maximum: 0 } } }), responseSchemaJson: JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", $ref: "#/$defs/Same", $defs: { Same: { type: "integer", minimum } } }) }));
    writeFileSync(file, generateNativeEffect(operations));
    try {
      const module = await jiti.import<{ nativeEffectResponseDefinitions: Record<string, Record<string, Schema.Decoder<unknown>>>; nativeEffectSchemas: Record<string, { request: Schema.Decoder<unknown>; response: Schema.Decoder<unknown> }> }>(file);
      expect(Schema.decodeUnknownSync(module.nativeEffectResponseDefinitions.op1.Same)(5)).toBe(5);
      expect(() => Schema.decodeUnknownSync(module.nativeEffectResponseDefinitions.op10.Same)(5)).toThrow();
      expect(Schema.decodeUnknownSync(module.nativeEffectSchemas.op1.request)(-1)).toBe(-1);
      expect(() => Schema.decodeUnknownSync(module.nativeEffectSchemas.op1.request)(5)).toThrow();
      expect(() => Schema.decodeUnknownSync(module.nativeEffectSchemas.op1.response)(-1)).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("refuses missing and cyclic definition references with their source", () => {
    for (const $defs of [{ Broken: { $ref: "#/$defs/Missing" } }, { A: { $ref: "#/$defs/B" }, B: { $ref: "#/$defs/A" } }])
      expect(() => emitSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { value: { $ref: `#/$defs/${Object.keys($defs)[0]}` } }, $defs }, "Bad", true)).toThrow();
    expect(() => generateNativeEffect([{ key: "origin", requestSchemaJson: "{}", responseSchemaJson: JSON.stringify({ type: "object", $defs: { Broken: { unsupportedConstraint: true } } }) }])).toThrow(/origin\/response:.*Broken/s);
  });
  it("covers every catalog direction and regenerates identical bytes", () => {
    expect(Object.keys(nativeEffectSchemas)).toEqual(hostOpCatalog.map(op => op.key));
    expect(generateNativeEffect(hostOpCatalog)).toBe(readFileSync(resolve(import.meta.dirname, "../../../packages/host-contracts/src/generated/native-effect.generated.ts"), "utf8").replaceAll("\r\n", "\n"));
    let definitions = 0;
    for (const operation of hostOpCatalog) {
      const root = JSON.parse(operation.responseSchemaJson);
      const keys = Object.keys(root.definitions ?? root.$defs ?? {}).sort();
      expect(Object.keys(nativeEffectResponseDefinitions[operation.key]), operation.key).toEqual(keys);
      definitions += keys.length;
    }
    expect(definitions).toBe(896);
    const mark = nativeEffectResponseDefinitions["revit.context.view-image"].RevitViewImageMark;
    expect(Schema.decodeUnknownSync(mark)({ elementId: 1, left: 0, top: 0, width: 1, height: 1 })).toEqual({ elementId: 1, left: 0, top: 0, width: 1, height: 1 });
    expect(() => Schema.decodeUnknownSync(mark)({ elementId: 9007199254740992, left: 0, top: 0, width: 1, height: 1 })).toThrow();
  });
  it("rejects unknown keywords and unsupported dialects, including unused definitions", () => {
    for (const input of [
      { type: "string", typoMinLength: 4 }, { type: "string", format: "email" },
      { $schema: "draft04", type: "string" },
      { type: "object", definitions: { Unused: { contains: { type: "string" } } } },
      { type: "object", properties: { nested: { $schema: "draft04", type: "string" } } },
      { $schema: "http://json-schema.org/draft-04/schema#", type: "number", exclusiveMinimum: 2 },
    ]) expect(() => schemaCode(input)).toThrow();
  });
  it("preserves draft04 exclusive bounds rather than relabeling booleans", async () => {
    const decoder = await generated({ $schema: "http://json-schema.org/draft-04/schema#", type: "number", minimum: 1, exclusiveMinimum: true });
    expect(() => Schema.decodeUnknownSync(decoder)(1)).toThrow();
    expect(Schema.decodeUnknownSync(decoder)(2)).toBe(2);
  });
  it("retains false schemas on properties, definition targets and union arms", async () => {
    for (const input of [
      { type: "object", properties: { blocked: false }, additionalProperties: false },
      { type: "object", properties: { blocked: { $ref: "#/$defs/Blocked" } }, $defs: { Blocked: false }, additionalProperties: false },
    ]) {
      const decoder = await generated({ $schema: "https://json-schema.org/draft/2020-12/schema", ...input });
      expect(Schema.decodeUnknownSync(decoder)({})).toEqual({});
      expect(() => Schema.decodeUnknownSync(decoder)({ blocked: 1 })).toThrow();
    }
    const union = await generated({ $schema: "https://json-schema.org/draft/2020-12/schema", anyOf: [false, { type: "string" }] });
    expect(() => Schema.decodeUnknownSync(union)(1)).toThrow();
    expect(Schema.decodeUnknownSync(union)("allowed")).toBe("allowed");
    expect(() => schemaCode({ $schema: "http://json-schema.org/draft-04/schema#", type: "object", properties: { blocked: false } })).toThrow();
  });
  it("applies referenced defaults like inline twins through object, optional and array composition", async () => {
    const inline = await generated({ type: "object", additionalProperties: false, properties: { count: { type: "integer", default: 8 } } });
    const referenced = await generated({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false,
      properties: { count: { $ref: "#/$defs/Count" } }, $defs: { Count: { type: "integer", default: 8 } } });
    const alias = await generated({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false,
      properties: { count: { $ref: "#/$defs/Alias" } }, $defs: { Alias: { $ref: "#/$defs/Count" }, Count: { type: "integer", default: 8 } } });
    for (const decoder of [inline, referenced, alias]) {
      expect(Schema.decodeUnknownSync(decoder)({})).toEqual({ count: 8 });
      const composed = Schema.Struct({ optional: Schema.optionalKey(decoder), rows: Schema.Array(decoder), object: Schema.Struct({ nested: decoder }) });
      expect(Schema.decodeUnknownSync(composed)({ optional: {}, rows: [{}], object: { nested: {} } })).toEqual({ optional: { count: 8 }, rows: [{ count: 8 }], object: { nested: { count: 8 } } });
      expect(Schema.decodeUnknownSync(composed)({ rows: [], object: { nested: { count: 5 } } })).toEqual({ rows: [], object: { nested: { count: 5 } } });
      expect(() => Schema.decodeUnknownSync(composed)({ rows: [{ count: 1, excess: true }], object: { nested: {} } })).toThrow();
    }
  });
  it("preserves defaults, requiredness, nullability, exact IDs, int32 and dates", async () => {
    const decoder = await generated({ type: "object", additionalProperties: false,
      properties: { count: { type: "integer", format: "int32", default: 8 }, id: { type: "integer", format: "int64" }, at: { type: ["string", "null"], format: "date-time" } }, required: ["id", "at"] });
    const decode = Schema.decodeUnknownSync(decoder);
    expect(decode({ id: 1, at: null })).toEqual({ id: 1, at: null, count: 8 });
    for (const value of [
      { id: 1 }, { id: 1, at: "2026-02-30T00:00:00Z" }, { id: 1, at: "bad" },
      { id: 9007199254740992, at: null }, { id: 1, at: null, count: 2147483648 },
      { id: 1, at: null, extra: true }, { id: 1, at: null, count: null },
    ]) expect(() => decode(value)).toThrow();
    expect(decode({ id: Number.MAX_SAFE_INTEGER, at: "2024-02-29T23:59:59.123+05:30", count: 2147483647 })).toEqual({ id: Number.MAX_SAFE_INTEGER, at: "2024-02-29T23:59:59.123+05:30", count: 2147483647 });
  });
});

it("decodes retained wire recordings through the provenance-checked loader", () => {
  const provenance = JSON.parse(readFileSync(resolve(import.meta.dirname, "native-recordings/provenance.json"), "utf8"));
  const results: Record<string, unknown> = {};
  const refused: string[] = [];
  for (const [name, record] of Object.entries(provenance) as [string, { operation: string; source: string; requestFile?: string }][]) {
    const schema = Object.entries(nativeEffectSchemas).find(([operation]) => operation === record.operation)?.[1];
    // Catalog and retired operations are classified explicitly, never decoded as
    // another operation and never replaced by a live source.
    if (!schema) { results[name] = { operation: record.operation, source: record.source, state: "no-current-operation" }; continue; }
    const recording = nativeRecordings(name);
    const directions: Record<string, unknown> = {};
    for (const [direction, value] of [["response", recording.responses[record.operation]], ...(record.requestFile ? [["request", nativeRecordingRequest(name)]] : [])] as const) {
      try {
        Schema.decodeUnknownSync(schema[direction as "request" | "response"])(value);
        directions[direction as string] = "decoded";
      } catch (cause) { directions[direction as string] = String(cause); refused.push(`${name}/${direction}`); }
    }
    results[name] = { operation: record.operation, source: recording.sources[record.operation], directions };
  }
  if (process.env.S3_RECORDING_REPORT) writeFileSync(process.env.S3_RECORDING_REPORT, JSON.stringify(results, null, 2));
  expect(Object.keys(results)).toHaveLength(38);
  expect(refused).toEqual(["manuella-adopt/response"]);
  // The receipt lists failures with exact names and provenance. A green census
  // is not a claim that historical bodies match today's C# contract.
  expect(results["fresh-rooms.draw"]).toMatchObject({ directions: { request: "decoded", response: "decoded" } });
});

// This replay is opt-in because the retained run is not a portable test fixture.
// It must run in the writer receipt. Missing native pairs stay missing coverage.
describe.skipIf(!process.env.E0_CORPUS)("frozen E0 replay", () => {
  it("checks all 47 planted/retained cases and the default normalization", async () => {
    const dir = process.env.E0_CORPUS!;
    const schemas = JSON.parse(readFileSync(resolve(dir, "schemas.json"), "utf8"));
    const cases = JSON.parse(readFileSync(resolve(dir, "cases.json"), "utf8")) as { id: string; schema: string; x: unknown; expect: boolean }[];
    expect(cases).toHaveLength(47);
    for (const [key, input] of Object.entries(schemas)) {
      const decoder = await generated(input as Record<string, any>);
      for (const c of cases.filter(c => c.schema === key)) {
        let accepted = false;
        let value: unknown;
        try { value = Schema.decodeUnknownSync(decoder)(c.x); accepted = true; } catch {}
        expect(accepted, c.id).toBe(c.expect);
        if (c.id === "tool-default") expect(value).toEqual({ limit: 8 });
        else if (c.expect) expect(value, c.id).toEqual(c.x);
      }
    }
  });
});
