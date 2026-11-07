import { registerHooks } from "node:module";
import ts from "typescript";
// Receipts describe production resolution even when a dev/test launcher verifies them.
process.env.NODE_ENV = "production";
// Styles have no bearing on a metadata projection. No component is rendered.
registerHooks({
  load(url, context, next) {
    return url.endsWith(".css")
      ? { format: "module", source: "export {};", shortCircuit: true }
      : next(url, context);
  },
});
/** Graph declarations own the directory and Pea projections; browser bodies never ship to MCP. */
import { createJiti } from "jiti";
import {
  buildBuiltinClosures,
  routeSourceHash,
  writeBuiltinClosurePin,
} from "../route-source-hash.ts";
import { readdir, mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import { familyFixturesDir } from "../checkout-paths.ts";
const jiti = createJiti(import.meta.url, {
  fsCache: false,
  jsx: { runtime: "automatic" },
  alias: {
    "#/family/authored-families": fileURLToPath(
      new URL("./route-projection-fixtures.ts", import.meta.url),
    ),
    "./generated/route-directory.ts": fileURLToPath(
      new URL("./route-projection-runtime.ts", import.meta.url),
    ),
    "./builtin-routes": fileURLToPath(new URL("./route-projection-runtime.ts", import.meta.url)),
    "#/route/builtin-routes": fileURLToPath(
      new URL("./route-projection-runtime.ts", import.meta.url),
    ),
    "./build-stamp": fileURLToPath(new URL("./route-projection-runtime.ts", import.meta.url)),
    "#/host/runtime": fileURLToPath(new URL("./route-projection-runtime.ts", import.meta.url)),
    "#/": fileURLToPath(new URL("../src/", import.meta.url)),
  },
});
const { projectRouteGraph } =
  await jiti.import<typeof import("@pe/agent-contracts")>("@pe/agent-contracts");
const { canonicalRouteJson, projectKernelDirectory } =
  await jiti.import<typeof import("@pe/agent-contracts")>("@pe/agent-contracts");
const check = process.argv.includes("--check");
// Write every builtin closure (untracked build output) without rewriting tracked projections.
const closureOnly = process.argv.includes("--builtin-closure-only");
const runtime = process.argv.includes("--runtime");
if (check && runtime) throw Error("--check is read-only and cannot use runtime projection flags");
const projections: Record<string, string> = {};
const stale: string[] = [];
async function emit(destination: URL, text: string) {
  const closure = destination.pathname.endsWith("/source-closure.generated.json");
  if (runtime) {
    projections[fileURLToPath(destination)] = text;
  } else if (check) {
    // Closures are build output, never tracked: nothing on disk to compare.
    if (closure) return;
    let current: string | undefined;
    try {
      current = await readFile(destination, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (current?.replaceAll("\r\n", "\n") !== text) stale.push(fileURLToPath(destination));
  } else {
    await mkdir(new URL(".", destination), { recursive: true });
    if (closure) writeBuiltinClosurePin(fileURLToPath(destination), text);
    else await writeFile(destination, text);
  }
}
const { admittedBuiltinKeys } = await jiti.import<
  typeof import("../../../packages/agent-contracts/src/admitted-builtin-keys.ts")
>("../../../packages/agent-contracts/src/admitted-builtin-keys.ts");
const root = fileURLToPath(new URL("../", import.meta.url));
const builtinOptions = [];
for (const key of admittedBuiltinKeys) {
  const files = await readdir(new URL(`../src/${key}/`, import.meta.url));
  const kernel = files.includes("route.ts")
    ? "route.ts"
    : files.includes("kernel.ts")
      ? "kernel.ts"
      : "kernel.tsx";
  const entry = fileURLToPath(new URL(`../src/${key}/${kernel}`, import.meta.url));
  const { module } = await jiti.import<{ module: { data: unknown } }>(entry);
  if (kernel === "route.ts") {
    const typed = module as unknown as import("../src/route/typed-route.ts").TypedRoute;
    const { z } = await import("zod");
    const fields = Object.entries(typed.spec.fields).map(([key, field]) => {
      const json = z.toJSONSchema(field.schema, { io: "input" });
      const schema = field.role === "subject"
        ? `subjectSchema(${(json.oneOf as {properties?:{ids?:{maxItems?:number}}}[]).find(part=>part.properties?.ids)?.properties!.ids!.maxItems})`
        : `z.fromJSONSchema(${JSON.stringify(json)})`;
      return `${JSON.stringify(key)}: field(${schema}.default(${JSON.stringify(field.initial)}), ${JSON.stringify(field.url)})`;
    });
    await emit(new URL(`../../../packages/agent-contracts/src/routes/${key}.ts`, import.meta.url),
      `// Generated from ${key}/route.ts by codegen:routes. Do not edit.\nimport { z } from "zod";\nimport { subjectSchema, focusSelectionSchema } from "../route-kernel-codecs.ts";\nimport { jsonCodec } from "../route-field.ts";\nconst field = <S extends z.ZodType>(schema:S,url:"push"|"replace") => ({ schema, url, agent:"set" as const, codec: jsonCodec(schema) });\nexport const ${key}Address = { path: ${JSON.stringify(typed.data.address)} as const, title: ${JSON.stringify(typed.spec.name)}, fields: {\n${fields.join(",\n")},\nselected: {...field(focusSelectionSchema,"replace"),agent:undefined}\n}, agent: { policy: ${JSON.stringify(`Choose ${typed.spec.subject.noun} through ${typed.spec.subject.field}, using the module's local identities.`)} } };\n`);
    // Preserve the actual imported Work export, including refinements and reconciliation.
    // JSON Schema cannot carry that authority; a second handwritten host declaration would drift.
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
            (property) =>
              ts.isPropertyAssignment(property) && property.name.getText(code) === "work",
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
    const workDestination = new URL(`../../../packages/agent-contracts/src/generated/${key}-work.ts`, import.meta.url);
    const schemaImport = binding.specifier.startsWith(".")
      ? JSON.stringify(relative(dirname(fileURLToPath(workDestination)), resolve(dirname(entry),binding.specifier)).replaceAll("\\","/"))
      : binding.from;
    const definitions = await jiti.import<Record<string, {schema?: unknown}>>(binding.specifier.startsWith(".") ? resolve(dirname(entry),binding.specifier) : binding.specifier);
    await emit(workDestination, definitions[binding.imported]!.schema
      ? `// Generated from ${key}/route.ts by codegen:routes. Do not edit.\nexport { ${binding.imported} as ${key}RouteState } from ${schemaImport};\n`
      : `// Generated from ${key}/route.ts by codegen:routes. Do not edit.\nimport { ${binding.imported} as schema } from ${schemaImport};\nimport { salvageWork } from "../route-state.ts";\nexport const ${key}RouteState = { route: ${JSON.stringify(key)}, title: ${JSON.stringify(typed.spec.name)}, description: schema.description ?? ${JSON.stringify(typed.spec.directory.summary)}, schema, schemaVersion: 1, salvage: (raw:unknown)=>salvageWork(schema,raw).doc };\n`);
    const history = typed.host.schemas.historyDetail!;
    await emit(new URL(`../src/${key}/host.generated.ts`, import.meta.url),
      `// Generated from route.ts by codegen:routes. Do not edit.\nimport { ${key}RouteState as work } from "../../../../packages/agent-contracts/src/generated/${key}-work.ts";\nimport { z } from "zod";\nimport { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";\nimport type { HostRouteModule } from "@pe/agent-contracts";\nimport closure from "./source-closure.generated.json" with { type: "json" };\nconst data = RouteGraphJson.parse(closure.envelope.data);\nexport const host: HostRouteModule = { data, workState: work, readWorks: ${JSON.stringify(typed.host.readWorks)}, schemas: { [data.work!.schema!]: work.schema, [data.historyDetail!]: z.fromJSONSchema(${JSON.stringify(z.toJSONSchema(history,{io:"input"}))}) }, bodies: {} };\n`);

  }
  builtinOptions.push({
    root,
    identityRoot: fileURLToPath(new URL("../../../../", import.meta.url)),
    data: module.data,
    variants: (["web", "pea"] as const).map((client) => ({
      client,
      entry,
    })),
    config: {
      resolve: {
        tsconfigPaths: true,
        dedupe: ["react", "react-dom"],
        alias: { "@family-fixtures": familyFixturesDir },
      },
    },
  });
}
const closures = await buildBuiltinClosures(builtinOptions);
const directory = [];
for (const [key, closure] of closures) {
  await emit(
    new URL(`../src/${key}/source-closure.generated.json`, import.meta.url),
    canonicalRouteJson(closure) + "\n",
  );
  if (closureOnly) continue;
  const data = closure.envelope.data;
  directory.push({ key, directory: projectKernelDirectory(data) });
  await emit(
    new URL(`../../../packages/mcps/src/pea/generated/${key}-graph.json`, import.meta.url),
    `${JSON.stringify(data, null, 2)}\n`,
  );
}
for (const folder of (await readdir(new URL("../src/", import.meta.url), { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))) {
  const files = await readdir(new URL(`../src/${folder.name}/`, import.meta.url));
  if (!files.includes("graph.ts")) continue;
  if (closures.has(folder.name)) continue;
  if (closureOnly) continue;
  const module = await jiti.import<Record<string, unknown>>(`../src/${folder.name}/graph.ts`);
  const graphs = Object.entries(module).filter(([name]) => name.endsWith("Graph"));
  for (const [, exported] of graphs) {
    const graph = exported as Parameters<typeof projectRouteGraph>[0];
    if (!graph || typeof graph !== "object" || !graph.key) continue;
    if (!graph.directory) throw Error(`${graph.key} has no directory declaration`);
    graph.moduleHash = routeSourceHash(
      await readFile(new URL(`../src/${folder.name}/graph.ts`, import.meta.url)),
    );
    directory.push({
      key: graph.key,
      directory: graph.directory,
    });
    const destination = new URL(
      `../../../packages/mcps/src/pea/generated/${graph.key}-graph.json`,
      import.meta.url,
    );
    await emit(destination, `${JSON.stringify(projectRouteGraph(graph), null, 2)}\n`);
  }
}
if (!closureOnly)
  await emit(
    new URL("../../../packages/agent-contracts/src/generated/route-directory.ts", import.meta.url),
    `// Generated from web route graphs by codegen:routes.\nimport type { RouteDirectory } from "../route-graph.ts";\nexport const routeDirectory: readonly {key: string; directory: RouteDirectory}[] = ${JSON.stringify(directory, null, 2)};\n`,
  );
console.log(runtime ? JSON.stringify(projections) : `Projected ${directory.length} route graphs`);

if (stale.length)
  throw Error(`Generated route artifacts drifted; run codegen:routes:\n${stale.join("\n")}`);
