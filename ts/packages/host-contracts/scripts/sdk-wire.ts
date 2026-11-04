import ts from "typescript";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Project the SDK's generated types. Do not add local wire fields or verb/result associations here.
const input = fileURLToPath(
  new URL("../src/vendor/generated/pe-revit-contract.ts", import.meta.url),
);
const output = fileURLToPath(new URL("../src/vendor/generated/pe-revit-wire.ts", import.meta.url));
const program = ts.createProgram([input], {
  strictNullChecks: true,
  target: ts.ScriptTarget.ESNext,
});
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
  if (type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any | ts.TypeFlags.TypeParameter))
    return "unknown";
  if (type.flags & ts.TypeFlags.Null) return "null";
  if (type.isStringLiteral() || type.isNumberLiteral()) return { literal: type.value };
  if (type.flags & ts.TypeFlags.BooleanLiteral)
    return { literal: checker.typeToString(type) === "true" };
  if (type.isUnion()) return { union: type.types.map(shape) };
  if (type.flags & ts.TypeFlags.String) return "string";
  if (type.flags & ts.TypeFlags.Number) return "number";
  if (type.flags & ts.TypeFlags.Boolean) return "boolean";
  if (checker.isArrayType(type))
    return { array: shape(checker.getTypeArguments(type as ts.TypeReference)[0]!) };
  const args = (type as ts.TypeReference).typeArguments;
  if (type.symbol?.name === "ReadonlyArray") return { array: shape(args![0]!) };
  if (type.flags & ts.TypeFlags.Object) {
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
for (const statement of source.statements)
  if (ts.isInterfaceDeclaration(statement)) shape(checker.getTypeAtLocation(statement));
const resultTypes = source.statements
  .filter(ts.isInterfaceDeclaration)
  .map((s) => s.name.text)
  .filter((n) => n !== "Envelope");
const text = `// DO NOT EDIT. Projected from pe-revit-contract.ts by scripts/sdk-wire.ts.\n// SDK authority has no verb/result association; unknown payload leaves remain unknown.\nexport const contractSha256 = ${JSON.stringify(createHash("sha256").update(readFileSync(input, "utf8").replace(/\r\n/g, "\n")).digest("hex"))};\nexport const wire = ${
  "{\n" +
  Object.entries(definitions)
    .map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`)
    .join(",\n") +
  "\n}"
};\nexport const resultTypes = ${JSON.stringify(resultTypes)};\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8").replace(/\r\n/g, "\n") !== text)
    throw Error("SDK wire projection drift: run node scripts/sdk-wire.ts");
} else writeFileSync(output, text);
