import { JsonSchema, SchemaRepresentation as Rep } from "effect";

type Node = JsonSchema.JsonSchema;
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);
type Operation = {
  key: string;
  requestSchemaJson: string;
  responseSchemaJson: string;
  artifactSchemaJson?: string;
};

// This is the catalog's vocabulary, not a permissive draft04 relabel. Unknown
// validation keywords fail even in unused definitions. Effect owns translation.
const keywords = new Set([
  "$schema",
  "title",
  "description",
  "type",
  "$ref",
  "definitions",
  "$defs",
  "properties",
  "additionalProperties",
  "required",
  "items",
  "oneOf",
  "anyOf",
  "allOf",
  "enum",
  "const",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "default",
  "x-enumNames",
  "x-enumFlags",
  "x-options",
]);

function normalize(input: unknown, path: string, draft04: boolean): Node | boolean {
  // Object spread would erase false before the importer can lower it to Never.
  if (typeof input === "boolean") {
    if (draft04) throw Error(`${path}: draft04 boolean schema unsupported`);
    return input;
  }
  if (!isNode(input)) throw Error(`${path}: expected a schema object`);
  const node = { ...input };
  for (const key of Object.keys(node))
    if (!keywords.has(key)) throw Error(`${path}: unsupported keyword ${key}`);
  if (node.$schema !== undefined && path !== "#")
    throw Error(`${path}: nested dialect unsupported`);
  if (node.$schema !== undefined) delete node.$schema;
  if (
    draft04 &&
    node.$ref &&
    Object.keys(node).some((k) => k !== "$ref" && k !== "description" && k !== "title")
  )
    throw Error(`${path}: draft04 $ref siblings are unsupported`);
  for (const [exclusive, bound] of [
    ["exclusiveMinimum", "minimum"],
    ["exclusiveMaximum", "maximum"],
  ]) {
    if (draft04 && node[exclusive] !== undefined) {
      if (typeof node[exclusive] !== "boolean")
        throw Error(`${path}: draft04 ${exclusive} must be boolean`);
      if (node[exclusive]) {
        if (typeof node[bound] !== "number") throw Error(`${path}: missing ${bound}`);
        node[exclusive] = node[bound];
        delete node[bound];
      } else delete node[exclusive];
    }
  }
  switch (node.format) {
    case undefined:
      break;
    case "int32":
      if (!(Array.isArray(node.type) ? node.type : [node.type]).includes("integer"))
        throw Error(`${path}: int32 requires integer`);
      if (node.minimum !== undefined && typeof node.minimum !== "number")
        throw Error(`${path}: minimum must be a number`);
      if (node.maximum !== undefined && typeof node.maximum !== "number")
        throw Error(`${path}: maximum must be a number`);
      node.minimum = Math.max(node.minimum ?? -2147483648, -2147483648);
      node.maximum = Math.min(node.maximum ?? 2147483647, 2147483647);
      break;
    case "int64":
      if (!(Array.isArray(node.type) ? node.type : [node.type]).includes("integer"))
        throw Error(`${path}: int64 requires integer`);
      break; // Effect integer means safe integer, including exact numeric IDs.
    case "double":
    case "float":
      if (!(Array.isArray(node.type) ? node.type : [node.type]).includes("number"))
        throw Error(`${path}: numeric format requires number`);
      break;
    case "date-time":
    case "guid":
      if (!(Array.isArray(node.type) ? node.type : [node.type]).includes("string"))
        throw Error(`${path}: string format requires string`);
      break;
    default:
      throw Error(`${path}: unsupported format ${node.format}`);
  }
  for (const key of ["properties", "definitions", "$defs"])
    if (node[key]) {
      if (!isNode(node[key])) throw Error(`${path}/${key}: expected a schema map`);
      node[key] = Object.fromEntries(
        Object.entries(node[key]).map(([name, value]) => [
          name,
          normalize(value, `${path}/${key}/${name}`, draft04),
        ]),
      );
    }
  for (const key of ["items", "additionalProperties"])
    if (key === "items" && typeof node[key] === "boolean")
      node[key] = normalize(node[key], `${path}/${key}`, draft04);
    else if (node[key] && typeof node[key] === "object") {
      if (Array.isArray(node[key])) throw Error(`${path}: tuple items unsupported`);
      node[key] = normalize(node[key], `${path}/${key}`, draft04);
    }
  for (const key of ["oneOf", "anyOf", "allOf"])
    if (node[key]) {
      if (!Array.isArray(node[key])) throw Error(`${path}/${key}: expected a schema array`);
      node[key] = node[key].map((value: unknown, i: number) =>
        normalize(value, `${path}/${key}/${i}`, draft04),
      );
    }
  return node;
}

function wrap(node: Rep.Representation, runtime: (code: string) => string): Rep.Declaration {
  return {
    _tag: "Declaration",
    typeParameters: [node],
    checks: [],
    annotations: {
      toCode: ({ typeParameters }: Rep.Generation.DeclarationInput) => ({
        runtime: runtime(typeParameters[0].runtime),
        Type: typeParameters[0].Type,
      }),
    },
  };
}

// Importer's annotations preserve formats/defaults but do not implement them.
// Augment its representation at those two metadata seams before its code emitter.
function effectiveDefault(
  node: Rep.Representation,
  references: Rep.References,
  seen = new Set<string>(),
): unknown {
  if (node._tag === "Reference") {
    if (seen.has(node.$ref)) throw Error(`Cyclic default reference ${node.$ref}`);
    if (!Object.hasOwn(references, node.$ref))
      throw Error(`Missing default reference ${node.$ref}`);
    seen.add(node.$ref);
    return effectiveDefault(references[node.$ref], references, seen);
  }
  if (node.annotations?.default !== undefined) return node.annotations.default;
  return node._tag === "Suspend" ? effectiveDefault(node.thunk, references, seen) : undefined;
}

function augment(
  node: Rep.Representation,
  references: Rep.References,
  decoderReferences = false,
): Rep.Representation {
  const recur = (node: Rep.Representation) => augment(node, references, decoderReferences);
  // Upstream recursive code assumes Codec<T,T>; decoding defaults change Encoded.
  // A Reference's emitted Type is its emitter-owned identifier, also the value name.
  if (decoderReferences && node._tag === "Reference")
    return {
      _tag: "Declaration",
      typeParameters: [node],
      checks: [],
      annotations: {
        toCode: ({ typeParameters: [ref] }: Rep.Generation.DeclarationInput) => ({
          runtime: `Schema.suspend((): Schema.Decoder<${ref.Type}> => ${ref.Type})`,
          Type: ref.Type,
        }),
      },
    };
  let result = node;
  switch (node._tag) {
    case "Objects":
      result = {
        ...node,
        propertySignatures: node.propertySignatures.map((property) => {
          let type = recur(property.type);
          const value = effectiveDefault(property.type, references);
          if (property.isOptional && value !== undefined) {
            type = wrap(
              type,
              (code) =>
                `${code}.pipe(Schema.withDecodingDefaultKey(Effect.succeed(${JSON.stringify(value)})))`,
            );
            return { ...property, type, isOptional: false };
          }
          return { ...property, type };
        }),
        indexSignatures: node.indexSignatures.map((s) => ({
          parameter: recur(s.parameter),
          type: recur(s.type),
        })),
      };
      break;
    case "Arrays":
      result = {
        ...node,
        elements: node.elements.map((e) => ({ ...e, type: recur(e.type) })),
        rest: node.rest.map(recur),
      };
      break;
    case "Union":
      result = { ...node, types: node.types.map(recur) };
      break;
    case "Suspend":
      result = decoderReferences
        ? {
            _tag: "Declaration",
            typeParameters: [recur(node.thunk)],
            checks: [],
            annotations: {
              toCode: ({ typeParameters: [thunk] }: Rep.Generation.DeclarationInput) => ({
                runtime: `Schema.suspend((): Schema.Decoder<${thunk.Type}> => ${thunk.runtime})`,
                Type: thunk.Type,
              }),
            },
          }
        : { ...node, thunk: recur(node.thunk) };
      break;
  }
  const format = "annotations" in node ? node.annotations?.format : undefined;
  if (format === "date-time")
    result = wrap(
      result,
      (code) =>
        `${code}.check(Schema.makeFilter((value) => typeof value !== "string" || validDateTime(value)))`,
    );
  if (format === "guid")
    result = wrap(
      result,
      (code) =>
        `${code}.check(Schema.makeFilter((value) => typeof value !== "string" || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)))`,
    );
  return result;
}

function compileSchemas(input: Node, includeDefinitions: boolean) {
  const dialect = input.$schema;
  if (
    dialect !== undefined &&
    dialect !== "http://json-schema.org/draft-04/schema#" &&
    dialect !== "https://json-schema.org/draft/2020-12/schema"
  )
    throw Error(`Unsupported dialect ${dialect}`);
  const normalized = normalize(input, "#", dialect === "http://json-schema.org/draft-04/schema#");
  if (typeof normalized === "boolean") throw Error("Boolean root unsupported; use an object root");
  const document =
    dialect === "https://json-schema.org/draft/2020-12/schema" || dialect === undefined
      ? JsonSchema.fromSchemaDraft2020_12(normalized)
      : JsonSchema.fromSchemaDraft07(normalized);
  const keys = Object.keys(document.definitions).sort();
  // Positions, not emitted identifier names, join source definitions to roots.
  const roots = Rep.fromJsonSchemaMultiDocument(
    {
      ...document,
      schemas: [
        document.schema,
        ...keys.map((key) => ({
          $ref: `#/$defs/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        })),
      ],
    },
    { patterns: "apply" },
  );
  const representation = Rep.toRepresentations([
    roots[0].ast,
    ...(includeDefinitions ? roots.slice(1).map((schema) => schema.ast) : []),
  ]);
  const project = (decoderReferences: boolean): Rep.MultiDocument => ({
    ...representation,
    representations: [
      augment(representation.representations[0], representation.references, decoderReferences),
      ...representation.representations
        .slice(1)
        .map((node) => augment(node, representation.references, decoderReferences)),
    ],
    references: Object.fromEntries(
      Object.entries(representation.references).map(([key, value]) => [
        key,
        augment(value, representation.references, decoderReferences),
      ]),
    ),
  });
  let code = Rep.toCodeDocument(project(false));
  // Use the upstream recursive partition, not a second dependency graph or name match.
  if (Object.keys(code.references.recursives).length) code = Rep.toCodeDocument(project(true));
  return {
    code,
    wire: Rep.toCodeDocument(representation),
    representation,
    definitionKeys: includeDefinitions ? keys : [],
  };
}

export function schemaCode(input: Node): Rep.CodeDocument {
  return compileSchemas(input, false).code;
}

export function emitSchema(
  input: Node,
  name: string,
  includeDefinitions = false,
  delivery = false,
): string {
  const {
    code: doc,
    wire,
    representation,
    definitionKeys,
  } = compileSchemas(input, includeDefinitions);
  const recursive = Object.keys(doc.references.recursives).length > 0;
  const declarations = doc.references.nonRecursives.map(
    (ref) =>
      `${recursive ? `type ${ref.$ref} = ${ref.code.Type};\n` : ""}const ${ref.$ref}${recursive ? `: Schema.Decoder<${ref.$ref}>` : ""} = ${ref.code.runtime};`,
  );
  for (const [name, code] of Object.entries(doc.references.recursives))
    declarations.push(
      `type ${name} = ${code.Type};\nconst ${name}: Schema.Decoder<${name}> = ${code.runtime};`,
    );
  if (doc.artifacts.length || wire.artifacts.length)
    throw Error("Catalog projection does not support imported code artifacts");
  // Upstream owns type syntax and recursive references. The pre-augmentation
  // graph retains optional wire keys that decoding defaults populate in Value.
  const wireReferences = [
    ...wire.references.nonRecursives.map((ref) => [ref.$ref, ref.code] as const),
    ...Object.entries(wire.references.recursives),
  ];
  const unique = (base: string, used: readonly string[]) => {
    while (used.includes(base)) base += "_";
    return base;
  };
  const wireRoot = unique(
    "Root",
    wireReferences.map(([key]) => key),
  );
  const wireTypes = `namespace WireTypes {\n${wireReferences.map(([key, code]) => `type ${key} = ${code.Type};`).join("\n")}\nexport type ${wireRoot} = ${wire.codes[0].Type};\n}\nexport type Wire = WireTypes.${wireRoot};\nexport type Value = typeof decoder.Type;\n`;
  if (delivery) {
    const root = representation.representations[0];
    // mapFields drops object checks. Refuse a changed source shape rather than
    // preserve checks whose meaning may depend on the removed delivery fields.
    if (
      root._tag !== "Objects" ||
      root.checks.length ||
      root.indexSignatures.length ||
      root.propertySignatures.some((property) => property.name === "capture")
    )
      throw Error("#/delivery: expected an unchecked closed image response Struct");
    for (const key of ["filePath", "imageUrl"]) {
      const property = root.propertySignatures.find((property) => property.name === key);
      if (
        !property?.isOptional ||
        property.type._tag !== "Union" ||
        property.type.checks.length ||
        property.type.types.length !== 2 ||
        !property.type.types.some((type) => type._tag === "Null") ||
        !property.type.types.some((type) => type._tag === "String" && type.checks.length === 0)
      )
        throw Error(`#/delivery/${key}: expected optional nullable string`);
    }
  }
  const deliveryFactory = delivery
    ? `export function delivery<S extends Schema.ConstraintDecoder<unknown, never>>(receipt: S) {\nreturn strictDecoder(codec.mapFields(fields => ({ ...Struct.omit(fields, ["filePath", "imageUrl"]), capture: Schema.NullOr(receipt), imageUrl: Schema.NullOr(Schema.String) })));\n}\n`
    : "";
  const definitions = includeDefinitions
    ? `export const definitions = {\n${definitionKeys.map((key, i) => `  [${JSON.stringify(key)}]: strictDecoder(${doc.codes[i + 1].runtime}),`).join("\n")}\n} as const;\n`
    : "";
  // The upstream allocator owns names inside each graph, not our public aliases.
  // A private structural scope prevents Wire/Value references from merging with them.
  return `export namespace ${name} {\nnamespace Decoded {\n${doc.artifacts.map((a) => (a._tag === "Import" ? a.importDeclaration : "")).join("\n")}\n${declarations.join("\n")}\nconst codec = ${doc.codes[0].runtime};\nexport const decoder = strictDecoder(codec);\n${deliveryFactory}${definitions}}\nexport const decoder = Decoded.decoder;\n${includeDefinitions ? "export const definitions = Decoded.definitions;\n" : ""}${delivery ? "export const delivery = Decoded.delivery;\n" : ""}${wireTypes}}\n`;
}

export const nativeEffectPrelude = `// Generated by host-typegen from C# JSON Schema. Do not edit.
import { Effect, Schema, SchemaParser, Struct } from "effect";
function strictDecoder<S extends Schema.ConstraintDecoder<unknown, never>>(codec: S): Schema.Decoder<S["Type"]> {
  return Schema.declareConstructor<S["Type"]>()([], () => (input, _ast, options) => SchemaParser.decodeUnknownEffect(codec)(input, { ...options, onExcessProperty: "error" }));
}
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
  const types: string[] = [];
  operations.forEach((op, index) => {
    const fields: string[] = [];
    const directions: string[] = [];
    for (const direction of ["request", "response", "artifact"] as const) {
      const json = op[`${direction}SchemaJson`];
      if (!json) continue;
      const name = `Op${index}${direction}`;
      const delivery =
        direction === "response" &&
        (op.key === "revit.context.view-image" || op.key === "revit.context.view-image.focus");
      try {
        chunks.push(emitSchema(JSON.parse(json), name, direction === "response", delivery));
      } catch (cause) {
        throw Error(`${op.key}/${direction}: ${String(cause)}`, { cause });
      }
      fields.push(`${direction}: ${name}.decoder`);
      if (delivery) fields.push(`delivery: ${name}.delivery`);
      directions.push(`${direction}: { wire: ${name}.Wire; value: ${name}.Value }`);
    }
    rows.push(`${JSON.stringify(op.key)}: { ${fields.join(", ")} }`);
    types.push(`${JSON.stringify(op.key)}: { ${directions.join("; ")} };`);
  });
  chunks.push(`export const nativeEffectSchemas = {\n${rows.join(",\n")}\n} as const;\n`);
  chunks.push(
    `export const nativeEffectResponseDefinitions = {\n${operations.map((op, i) => `  [${JSON.stringify(op.key)}]: Op${i}response.definitions,`).join("\n")}\n} as const;\n`,
  );
  chunks.push(
    `export interface NativeEffectValues {\n${types.join("\n")}\n}\nexport type NativeKey = keyof NativeEffectValues;\nexport type NativeRequestWire<K extends NativeKey> = NativeEffectValues[K]["request"]["wire"];\nexport type NativeRequestValue<K extends NativeKey> = NativeEffectValues[K]["request"]["value"];\nexport type NativeResponseValue<K extends NativeKey> = NativeEffectValues[K]["response"]["value"];\n`,
  );
  return chunks.join("\n");
}
