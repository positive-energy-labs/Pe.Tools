import ts from "typescript";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Project the SDK's generated types. Do not add local wire fields or verb/result associations here.
const input = fileURLToPath(
  new URL("../src/vendor/generated/pe-revit-contract.ts", import.meta.url),
).replace(/\\/g, "/");
const output = fileURLToPath(new URL("../src/vendor/generated/pe-revit-wire.ts", import.meta.url));
// Instantiate the generic frame as unknown; the SDK publishes no verb/result relation.
const frameInput = input.replace(/pe-revit-contract\.ts$/, "sdk-wire-frame.ts");
const options: ts.CompilerOptions = {
  strictNullChecks: true,
  target: ts.ScriptTarget.ESNext,
};
const host = ts.createCompilerHost(options);
const getSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
  file === frameInput
    ? ts.createSourceFile(
        file,
        'import type { Envelope } from "./pe-revit-contract.ts"; type Frame = Envelope<unknown>;',
        ts.ScriptTarget.ESNext,
      )
    : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
const program = ts.createProgram([input, frameInput], options, host);
const checker = program.getTypeChecker();
const source = program.getSourceFile(input)!;
type Shape =
  | string
  | { literal: unknown }
  | { union: Shape[] }
  | { array: Shape }
  | { fields: Record<string, Shape> };
const definitions: Record<string, Shape> = {};
function shape(type: ts.Type): Shape {
  if (type.flags & ts.TypeFlags.Unknown) return "unknown";
  if (type.flags & ts.TypeFlags.Null) return "null";
  if (type.isStringLiteral() || type.isNumberLiteral()) return { literal: type.value };
  if (type.flags & ts.TypeFlags.BooleanLiteral)
    return { literal: checker.typeToString(type) === "true" };
  if (type.isUnion()) return { union: type.types.map(shape) };
  if (type.flags & ts.TypeFlags.String) return "string";
  if (type.flags & ts.TypeFlags.Number) return "number";
  if (type.flags & ts.TypeFlags.Boolean) return "boolean";
  if (checker.isTupleType(type)) throw Error(`Unsupported SDK tuple ${checker.typeToString(type)}`);
  if (checker.isArrayType(type))
    return { array: shape(checker.getTypeArguments(type as ts.TypeReference)[0]!) };
  const args = (type as ts.TypeReference).typeArguments;
  if (type.symbol?.name === "ReadonlyArray") return { array: shape(args![0]!) };
  if (type.flags & ts.TypeFlags.Object) {
    if (
      checker.getIndexInfosOfType(type).length ||
      type.getCallSignatures().length ||
      type.getConstructSignatures().length
    )
      throw Error(`Unsupported structured SDK type ${checker.typeToString(type)}`);
    if ((type as ts.ObjectType).objectFlags & (ts.ObjectFlags.Mapped | ts.ObjectFlags.Class))
      throw Error(`Unsupported structured SDK type ${checker.typeToString(type)}`);
    const name = type.symbol?.name;
    if (!name || name === "__type")
      throw Error(`Unsupported SDK type ${checker.typeToString(type)}`);
    if (!(name in definitions)) {
      definitions[name] = "unknown";
      definitions[name] = {
        fields: Object.fromEntries(
          checker.getPropertiesOfType(type).map((property) => {
            if (property.flags & ts.SymbolFlags.Optional)
              throw Error(`Unsupported optional SDK field ${name}.${property.name}`);
            return [
              property.name,
              shape(checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration!)),
            ];
          }),
        ),
      };
    }
    return name;
  }
  throw Error(`Unsupported SDK type ${checker.typeToString(type)}`);
}
const frame = program.getSourceFile(frameInput)!.statements.find(ts.isTypeAliasDeclaration)!;
shape(checker.getTypeAtLocation(frame));
// Caller-selected contracts only. This is not an exhaustive payload union or a verb map.
const selected = [
  "SessionListResult",
  "SessionObservation",
  "ProcessIdentity",
  "DocumentInfo",
  "SessionDocument",
  "DocumentHoldings",
  "Holdings",
  "UpdatePlan",
  "UpdateReceipt",
];
const sdkExports = checker.getExportsOfModule(checker.getSymbolAtLocation(source)!);
for (const name of selected) {
  const symbol = sdkExports.find((symbol) => symbol.name === name);
  if (!symbol) throw Error(`SDK contract has no export ${name}`);
  const projected = shape(checker.getDeclaredTypeOfSymbol(symbol));
  definitions[name] ??= projected;
}
const text = `// DO NOT EDIT. Projected from pe-revit-contract.ts by scripts/sdk-wire.ts.\n// SDK authority has no verb/result association; unknown payload leaves remain unknown.\nimport type * as SDK from "./pe-revit-contract.ts";\nexport interface SelectedSdkTypes {\n${selected.map((name) => `  readonly ${name}: SDK.${name};`).join("\n")}\n}\nexport const contractSha256 = ${JSON.stringify(createHash("sha256").update(readFileSync(input, "utf8").replace(/\r\n/g, "\n")).digest("hex"))};\nexport const wire = ${
  "{\n" +
  Object.entries(definitions)
    .map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`)
    .join(",\n") +
  "\n}"
};\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8").replace(/\r\n/g, "\n") !== text)
    throw Error("SDK wire projection drift: run node scripts/sdk-wire.ts");
} else writeFileSync(output, text);
