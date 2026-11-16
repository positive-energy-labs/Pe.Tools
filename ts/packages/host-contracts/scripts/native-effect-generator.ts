import { JsonSchema, SchemaRepresentation as Rep } from "effect";

type Node = Record<string, any>;
type Operation = { key: string; requestSchemaJson: string; responseSchemaJson: string; artifactSchemaJson?: string };

// This is the catalog's vocabulary, not a permissive draft04 relabel. Unknown
// validation keywords fail even in unused definitions. Effect owns translation.
const keywords = new Set([
  "$schema", "title", "description", "type", "$ref", "definitions", "$defs",
  "properties", "additionalProperties", "required", "items", "oneOf", "anyOf", "allOf",
  "enum", "const", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "default",
  "x-enumNames", "x-enumFlags", "x-options",
]);

function normalize(input: Node, path: string, draft04: boolean): Node {
  const node = { ...input };
  for (const key of Object.keys(node))
    if (!keywords.has(key)) throw Error(`${path}: unsupported keyword ${key}`);
  if (node.$schema !== undefined && path !== "#") throw Error(`${path}: nested dialect unsupported`);
  if (node.$schema !== undefined) delete node.$schema;
  if (draft04 && node.$ref && Object.keys(node).some(k => k !== "$ref" && k !== "description" && k !== "title"))
    throw Error(`${path}: draft04 $ref siblings are unsupported`);
  for (const [exclusive, bound] of [["exclusiveMinimum", "minimum"], ["exclusiveMaximum", "maximum"]]) {
    if (draft04 && node[exclusive] !== undefined) {
      if (typeof node[exclusive] !== "boolean") throw Error(`${path}: draft04 ${exclusive} must be boolean`);
      if (node[exclusive]) {
        if (typeof node[bound] !== "number") throw Error(`${path}: missing ${bound}`);
        node[exclusive] = node[bound];
        delete node[bound];
      } else delete node[exclusive];
    }
  }
  switch (node.format) {
    case undefined: break;
    case "int32":
      if (!(Array.isArray(node.type) ? node.type : [node.type]).includes("integer")) throw Error(`${path}: int32 requires integer`);
      node.minimum = Math.max(node.minimum ?? -2147483648, -2147483648);
      node.maximum = Math.min(node.maximum ?? 2147483647, 2147483647);
      break;
    case "int64":
      if (!(Array.isArray(node.type) ? node.type : [node.type]).includes("integer")) throw Error(`${path}: int64 requires integer`);
      break; // Effect integer means safe integer, including exact numeric IDs.
    case "double": case "float":
      if (!(Array.isArray(node.type) ? node.type : [node.type]).includes("number"))
        throw Error(`${path}: numeric format requires number`);
      break;
    case "date-time": case "guid":
      if (!(Array.isArray(node.type) ? node.type : [node.type]).includes("string"))
        throw Error(`${path}: string format requires string`);
      break;
    default: throw Error(`${path}: unsupported format ${node.format}`);
  }
  for (const key of ["properties", "definitions", "$defs"])
    if (node[key]) node[key] = Object.fromEntries(Object.entries(node[key]).map(([name, value]) =>
      [name, normalize(value as Node, `${path}/${key}/${name}`, draft04)]));
  for (const key of ["items", "additionalProperties"])
    if (node[key] && typeof node[key] === "object") {
      if (Array.isArray(node[key])) throw Error(`${path}: tuple items unsupported`);
      node[key] = normalize(node[key], `${path}/${key}`, draft04);
    }
  for (const key of ["oneOf", "anyOf", "allOf"])
    if (node[key]) node[key] = node[key].map((value: Node, i: number) => normalize(value, `${path}/${key}/${i}`, draft04));
  return node;
}

function wrap(node: Rep.Representation, runtime: (code: string) => string): Rep.Declaration {
  return {
    _tag: "Declaration", typeParameters: [node], checks: [],
    annotations: { toCode: ({ typeParameters }: Rep.Generation.DeclarationInput) => ({
      runtime: runtime(typeParameters[0].runtime), Type: typeParameters[0].Type,
    }) },
  };
}

// Importer's annotations preserve formats/defaults but do not implement them.
// Augment its representation at those two metadata seams before its code emitter.
function augment(node: Rep.Representation): Rep.Representation {
  let result = node;
  switch (node._tag) {
    case "Objects": result = { ...node,
      propertySignatures: node.propertySignatures.map(property => {
        let type = augment(property.type);
        const value = "annotations" in property.type ? property.type.annotations?.default : undefined;
        if (property.isOptional && value !== undefined) {
          type = wrap(type, code => `${code}.pipe(Schema.withDecodingDefaultKey(Effect.succeed(${JSON.stringify(value)})))`);
          return { ...property, type, isOptional: false };
        }
        return { ...property, type };
      }),
      indexSignatures: node.indexSignatures.map(s => ({ parameter: augment(s.parameter), type: augment(s.type) })),
    }; break;
    case "Arrays": result = { ...node, elements: node.elements.map(e => ({ ...e, type: augment(e.type) })), rest: node.rest.map(augment) }; break;
    case "Union": result = { ...node, types: node.types.map(augment) }; break;
    case "Suspend": result = { ...node, thunk: augment(node.thunk) }; break;
  }
  const format = "annotations" in node ? node.annotations?.format : undefined;
  if (format === "date-time")
    result = wrap(result, code => `${code}.check(Schema.makeFilter((value) => typeof value !== "string" || validDateTime(value)))`);
  if (format === "guid")
    result = wrap(result, code => `${code}.check(Schema.makeFilter((value) => typeof value !== "string" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)))`);
  return result;
}

export function schemaCode(input: Node): Rep.CodeDocument {
  const dialect = input.$schema;
  if (dialect !== undefined && dialect !== "http://json-schema.org/draft-04/schema#" &&
    dialect !== "https://json-schema.org/draft/2020-12/schema") throw Error(`Unsupported dialect ${dialect}`);
  const normalized = normalize(input, "#", dialect === "http://json-schema.org/draft-04/schema#");
  const document = dialect === "https://json-schema.org/draft/2020-12/schema" || dialect === undefined
    ? JsonSchema.fromSchemaDraft2020_12(normalized)
    : JsonSchema.fromSchemaDraft07(normalized);
  const schema = Rep.fromJsonSchemaDocument(document, { patterns: "apply" });
  // Importer visits reachable definitions only. Refuse unsupported source even
  // when today's root does not reach it, so catalog churn cannot hide drift.
  for (const key of Object.keys(document.definitions))
    Rep.fromJsonSchemaDocument({ ...document, schema: { $ref: `#/$defs/${key.replaceAll("~", "~0").replaceAll("/", "~1")}` } }, { patterns: "apply" });
  const representation = Rep.toRepresentations([schema.ast]);
  return Rep.toCodeDocument({
    ...representation,
    representations: representation.representations.map(augment) as [Rep.Representation, ...Rep.Representation[]],
    references: Object.fromEntries(Object.entries(representation.references).map(([key, value]) => [key, augment(value)])),
  });
}

export function emitSchema(input: Node, name: string): string {
  const doc = schemaCode(input);
  const declarations = doc.references.nonRecursives.map(ref => `const ${ref.$ref} = ${ref.code.runtime};`);
  for (const [name, code] of Object.entries(doc.references.recursives))
    declarations.push(`type ${name} = ${code.Type};\nconst ${name}: Schema.Codec<${name}> = ${code.runtime};`);
  if (doc.artifacts.length) throw Error("Catalog projection does not support imported code artifacts");
  return `export namespace ${name} {\n${doc.artifacts.map(a => a._tag === "Import" ? a.importDeclaration : "").join("\n")}\n${declarations.join("\n")}\nconst codec = ${doc.codes[0].runtime};\nexport const decoder: Schema.Decoder<typeof codec.Type> = Schema.declareConstructor<typeof codec.Type>()([], () => (input, _ast, options) => SchemaParser.decodeUnknownEffect(codec)(input, { ...options, onExcessProperty: "error" }));\n}\n`;
}

export const nativeEffectPrelude = `// Generated by host-typegen from C# JSON Schema. Do not edit.
import { Effect, Schema, SchemaParser } from "effect";
// RFC3339 calendar and offset validation; Date.parse alone normalizes bad days.
function validDateTime(value: string): boolean {
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})[tT](\\d{2}):(\\d{2}):(\\d{2})(?:\\.\\d+)?(?:[zZ]|([+-])(\\d{2}):(\\d{2}))$/.exec(value);
  if (!match) return false;
  const [, y, m, d, h, min, s, , oh, om] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && Number(h) < 24 && Number(min) < 60 && Number(s) < 60 && (!oh || Number(oh) < 24 && Number(om) < 60);
}
`;

export function generateNativeEffect(operations: readonly Operation[]): string {
  const chunks = [nativeEffectPrelude];
  const rows: string[] = [];
  operations.forEach((op, index) => {
    const fields: string[] = [];
    for (const direction of ["request", "response", "artifact"] as const) {
      const json = op[`${direction}SchemaJson`];
      if (!json) continue;
      const name = `Op${index}${direction}`;
      try { chunks.push(emitSchema(JSON.parse(json), name)); }
      catch (cause) { throw Error(`${op.key}/${direction}: ${String(cause)}`, { cause }); }
      fields.push(`${direction}: ${name}.decoder`);
    }
    rows.push(`${JSON.stringify(op.key)}: { ${fields.join(", ")} }`);
  });
  chunks.push(`export const nativeEffectSchemas = {\n${rows.join(",\n")}\n} as const;\n`);
  return chunks.join("\n");
}
