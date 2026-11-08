import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import type { TypedRoute } from "../src/route/typed-route.ts";
/** Preserve imported Work functions and refinements in either builtin or Pod host projection. */
export async function projectWork(
  entry: string,
  typed: TypedRoute,
  destination: string,
  exportName: string,
  load: (specifier: string) => Promise<Record<string, { schema?: unknown }>>,
) {
  const code = ts.createSourceFile(
    entry,
    await readFile(entry, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let workName: string | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "route"
    ) {
      const spec = node.arguments[0];
      const edits =
        spec &&
        ts.isObjectLiteralExpression(spec) &&
        spec.properties.find(
          (property) =>
            ts.isPropertyAssignment(property) && property.name.getText(code) === "edits",
        );
      const work =
        edits &&
        ts.isPropertyAssignment(edits) &&
        ts.isObjectLiteralExpression(edits.initializer) &&
        edits.initializer.properties.find(
          (property) => ts.isPropertyAssignment(property) && property.name.getText(code) === "work",
        );
      if (work && ts.isPropertyAssignment(work) && ts.isIdentifier(work.initializer))
        workName = work.initializer.text;
    }
    ts.forEachChild(node, visit);
  };
  visit(code);
  const imports = code.statements.filter(ts.isImportDeclaration).flatMap((declaration) => {
    const names = declaration.importClause?.namedBindings;
    return names && ts.isNamedImports(names)
      ? names.elements.map((name) => ({
          local: name.name.text,
          imported: name.propertyName?.text ?? name.name.text,
          from: declaration.moduleSpecifier.getText(code),
          specifier: (declaration.moduleSpecifier as ts.StringLiteral).text,
        }))
      : [];
  });
  const binding = imports.find((binding) => binding.local === workName);
  if (!binding)
    throw Error(`${entry}: typed route Work must reference an imported Work definition`);
  const schemaImport = binding.specifier.startsWith(".")
    ? JSON.stringify(
        (() => {
          const path = relative(
            dirname(destination),
            resolve(dirname(entry), binding.specifier),
          ).replaceAll("\\", "/");
          return path.startsWith(".") ? path : `./${path}`;
        })(),
      )
    : binding.from;
  const definitions = await load(
    binding.specifier.startsWith(".")
      ? resolve(dirname(entry), binding.specifier)
      : binding.specifier,
  );
  const definition = definitions[binding.imported]!.schema
    ? `import { ${binding.imported} as ${exportName} } from ${schemaImport};\nexport { ${exportName} };\n`
    : `import { ${binding.imported} as schema } from ${schemaImport};\nexport const ${exportName}={route:${JSON.stringify(typed.data.key)},title:${JSON.stringify(typed.spec.name)},description:schema.description??${JSON.stringify(typed.spec.directory.summary)},schema,schemaVersion:1};\n`;
  const properties = `workState:work,readWorks:${JSON.stringify(typed.host.readWorks)},schemas:{[data.work!.schema!]:work.schema,[data.historyDetail!]:z.fromJSONSchema(${JSON.stringify(z.toJSONSchema(typed.host.schemas.historyDetail!, { io: "input" }))})},`;
  return { definition, properties };
}
