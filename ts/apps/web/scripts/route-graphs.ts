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
const discovered = await readdir(new URL("../src/",import.meta.url),{withFileTypes:true});
const declarations=new Map<string,{folder:string;file:string;module:{data:{key:string}}}>();
for(const dir of discovered.filter(d=>d.isDirectory())) {
  for(const file of ["route.ts","route.tsx","kernel.ts","kernel.tsx"]) {
    const text=await readFile(new URL(`../src/${dir.name}/${file}`,import.meta.url),"utf8").catch(()=>"");
    if(/export\s+(?:const|let)\s+module\b/.test(text)) {
      const {module}=await jiti.import<{module:{data:{key:string}}}>(fileURLToPath(new URL(`../src/${dir.name}/${file}`,import.meta.url)));
      if(declarations.has(module.data.key)) throw Error(`Duplicate route module ${module.data.key}`);
      declarations.set(module.data.key,{folder:dir.name,file,module});break;
    }
  }
}
const keys=[...new Set([...admittedBuiltinKeys,...declarations.keys()])].sort();
const links:string[]=[],hostImports:string[]=[],hostEntries:string[]=[];
const browserImports:string[]=[],browserEntries:string[]=[],typedImports:string[]=[],typedEntries:string[]=[],closureImports:string[]=[],closureEntries:string[]=[],hostReadImports:string[]=[],hostReadEntries:string[]=[];
for (const key of keys) {
  const folder=declarations.get(key)?.folder ?? key;
  const files = await readdir(new URL(`../src/${folder}/`, import.meta.url));
  const kernel = declarations.get(key)?.file ?? (files.includes("route.ts")
    ? "route.ts"
    : files.includes("kernel.ts")
      ? "kernel.ts"
      : "kernel.tsx");
  const entry = fileURLToPath(new URL(`../src/${folder}/${kernel}`, import.meta.url));
  const { module, router } = await jiti.import<{ module: { data: unknown }; router?: {contract?:string; dock?:boolean} }>(entry);
  closureImports.push(`import c${closureEntries.length} from "../${folder}/source-closure.generated.json" with {type:"json"};`);
  closureEntries.push(`${JSON.stringify(key)}:c${closureEntries.length}`);
  browserImports.push(`import {module as m${browserEntries.length}} from "../${folder}/${kernel}";`);
  browserEntries.push(`${JSON.stringify(key)}:m${browserEntries.length}`);
  if ("spec" in module) {
    const index=typedEntries.length;
    hostImports.push(`import {host as h${index}} from "../../../web/src/${folder}/host.generated.ts";`,`import c${index} from "../../../web/src/${folder}/source-closure.generated.json" with {type:"json"};`);
    hostEntries.push(`${JSON.stringify(key)}:{host:h${index},closure:closureSchema.parse(c${index})}`);
    typedImports.push(`import {host as h${index}} from "../${folder}/neutral.generated.ts";`, `import c${index} from "../${folder}/source-closure.generated.json" with {type:"json"};`);
    typedEntries.push(`${JSON.stringify(key)}:{host:h${index},closure:c${index}}`);
    const typed = module as unknown as import("../src/route/typed-route.ts").TypedRoute;

    const source = await readFile(entry, "utf8");
    const ast = ts.createSourceFile(entry, source, ts.ScriptTarget.Latest, true);
    const spec = ast.statements.flatMap(statement => ts.isVariableStatement(statement)
      ? statement.declarationList.declarations : []).find(d => d.name.getText(ast) === "module");
    const call = spec && spec.initializer;
    const object = call && ts.isCallExpression(call) && call.arguments[0];
    if (!object || !ts.isObjectLiteralExpression(object)) throw Error(`${key}: expected route({...})`);
    const member = (object: ts.ObjectLiteralExpression, name: string) => {
      const property = object.properties.find(p => p.name?.getText(ast) === name);
      return property && ts.isPropertyAssignment(property) ? property.initializer
        : property && ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
    };
    const typeOf = (node: ts.Node | undefined): string => {
      if (!node) return "never";
      const name = node.getText(ast);
      if (name === "{}") return "{}";
      if (name === "z.never()") return "never";
      for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        const binding = bindings.elements.find(b => b.name.text === name);
        if (binding) return `typeof import(${statement.moduleSpecifier.getText(ast)}).${binding.propertyName?.text ?? name}`;
      }
      return `typeof import("./${kernel}").${name}`;
    };
    const edits = member(object, "edits");
    const work = edits && ts.isObjectLiteralExpression(edits) ? member(edits, "work") : undefined;
    const input = edits && ts.isObjectLiteralExpression(edits) ? member(edits, "input") : undefined;
    const context = (read:ts.Node | undefined) => `ContextOf<${typeOf(member(object,"fields"))}, ${typeOf(read)}, ${typeOf(work)}, ${typeOf(input)}>`;
    const panes=member(object,"panes");
    const paneContexts=panes && ts.isObjectLiteralExpression(panes) ? panes.properties.flatMap(p => {
      if(!ts.isPropertyAssignment(p) || !ts.isObjectLiteralExpression(p.initializer)) return [];
      return [`${p.name.getText(ast)}: ${context(member(p.initializer,"read") ?? member(object,"core"))}`];
    }) : [];
    await emit(new URL(`../src/${folder}/context.generated.ts`,import.meta.url),
      `// Generated by codegen:routes. Do not edit.\nimport type { ContextOf } from "../route/defaults";\nexport type Context = ${context(member(object,"core"))};\ntype Panes = {${paneContexts.join(";\n")}};\nexport type PaneContext<P extends keyof Panes> = Panes[P];\n`);
    links.push(`${JSON.stringify(key)}:routeAddress(${JSON.stringify(router?.contract ?? key)}).link`);
    const leaf = typed.data.address === "/" ? "index" : typed.data.address.slice(1);
    if (!leaf.includes("/")) {
      // A retained surface can author a dock-only leaf alongside its declaration.
      await emit(new URL(`../src/routes/${leaf}.tsx`,import.meta.url),
        `// Generated by codegen:routes. Do not edit.\nimport { createFileRoute } from "@tanstack/react-router";\nimport { routeFile } from "../shell/route-file";\n${router?.dock ? "" : `import { TypedShell } from "../shell/typed-shell";\nimport { module } from "../${folder}/${kernel}";\nimport { builtinRouteStamp } from "../route/builtin-inventory";\nimport { workFingerprintSchema } from "@pe/agent-contracts";\n`}export const Route = createFileRoute(${JSON.stringify(typed.data.address)})({\n...routeFile(${JSON.stringify(router?.contract ?? key)}),\ncomponent: () => ${router?.dock ? "null" : `<TypedShell module={module} fingerprint={workFingerprintSchema.parse(\`builtin-closure:\${builtinRouteStamp(${JSON.stringify(key)})}\`)} />`}\n});\n`);
    }
    const { z } = await import("zod");
    const identifier=key.replace(/[^a-zA-Z0-9_$]+([a-zA-Z0-9_$])/g,(_all,part:string)=>part.toUpperCase());
    const fields = Object.entries(typed.spec.fields).map(([key, field]) => {
      const json = z.toJSONSchema(field.schema, { io: "input" });
      const schema = field.role === "subject"
        ? `subjectSchema(${(json.oneOf as {properties?:{ids?:{maxItems?:number}}}[]).find(part=>part.properties?.ids)?.properties!.ids!.maxItems})`
        : `z.fromJSONSchema(${JSON.stringify(json)})`;
      return `${JSON.stringify(key)}: field(${schema}${field.initial === undefined ? ".optional()" : `.default(${JSON.stringify(field.initial)})`}, ${JSON.stringify(field.url)})`;
    });
    await emit(new URL(`../../../packages/agent-contracts/src/routes/${key}.ts`, import.meta.url),
      `// Generated from ${key}/route.ts by codegen:routes. Do not edit.\nimport { z } from "zod";\nimport { ${typed.spec.subject?"subjectSchema, ":""}focusSelectionSchema } from "../route-kernel-codecs.ts";\nimport { jsonCodec } from "../route-field.ts";\nconst field = <S extends z.ZodType>(schema:S,url:"push"|"replace") => ({ schema, url, agent:"set" as const, codec: jsonCodec(schema) });\nexport const ${identifier}Address = { path: ${JSON.stringify(typed.data.address)} as const, title: ${JSON.stringify(typed.spec.name)}, fields: {\n${fields.length ? fields.join(",\n")+"," : ""}\nselected: {...field(focusSelectionSchema,"replace"),agent:undefined}\n}, agent: { policy: ${JSON.stringify(typed.spec.subject ? `Choose ${typed.spec.subject.noun} through ${typed.spec.subject.field}, using the module's local identities.` : "Use the route fields as declared.")} } };\n`);
    // Preserve the actual imported Work export, including refinements and reconciliation.
    // JSON Schema cannot carry that authority; a second handwritten host declaration would drift.
    let workImport="",workBody="";
    if(typed.spec.edits) {
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
      ? `// Generated from ${key}/route.ts by codegen:routes. Do not edit.\nexport { ${binding.imported} as ${identifier}RouteState } from ${schemaImport};\n`
      : `// Generated from ${key}/route.ts by codegen:routes. Do not edit.\nimport { ${binding.imported} as schema } from ${schemaImport};\nimport { salvageWork } from "../route-state.ts";\nexport const ${identifier}RouteState = { route: ${JSON.stringify(key)}, title: ${JSON.stringify(typed.spec.name)}, description: schema.description ?? ${JSON.stringify(typed.spec.directory.summary)}, schema, schemaVersion: 1, salvage: (raw:unknown)=>salvageWork(schema,raw).doc };\n`);
    workImport=`import { ${identifier}RouteState as work } from "../../../../packages/agent-contracts/src/generated/${key}-work.ts";\n`;
    workBody=`workState:work,readWorks:${JSON.stringify(typed.host.readWorks)},schemas:{[data.work!.schema!]:work.schema,[data.historyDetail!]:z.fromJSONSchema(${JSON.stringify(z.toJSONSchema(typed.host.schemas.historyDetail!,{io:"input"}))})},`;
    }
    const runtime=typed.spec.host;
    if(runtime) {
      const file=resolve(dirname(entry),runtime);
      const hostRoot=fileURLToPath(new URL("../../host/",import.meta.url));
      const inside=relative(hostRoot,file);
      if(inside.startsWith("..") || inside.startsWith("/")) throw Error(`${key}: host read modules must live under apps/host`);
      const directory=fileURLToPath(new URL("../../host/src/reads/",import.meta.url));
      const path=relative(directory,file).replaceAll("\\","/");
      hostReadImports.push(`import * as m${hostReadEntries.length} from ${JSON.stringify(path.startsWith(".")?path:`./${path}`)};`);
      hostReadEntries.push(`m${hostReadEntries.length}`);
    }
    await emit(new URL(`../src/${folder}/neutral.generated.ts`,import.meta.url),
      `// Generated from route.ts by codegen:routes. Neutral projection only.\n${workImport}${typed.spec.edits?'import {z} from "zod";\n':""}import {RouteGraphJson} from "../../../../packages/agent-contracts/src/route-kernel-data.ts";\nimport type {HostRouteModule} from "@pe/agent-contracts";\nimport closure from "./source-closure.generated.json" with {type:"json"};\nconst data=RouteGraphJson.parse(closure.envelope.data);\nexport const host:HostRouteModule={data,bodies:{},${workBody||"schemas:{},"}};\n`);
    await emit(new URL(`../src/${folder}/host.generated.ts`,import.meta.url),
      `// Generated from route.ts by codegen:routes. Host only.\nimport {host as neutral} from "./neutral.generated.ts";\n${runtime?`import * as runtime from ${JSON.stringify(runtime)};\n`:""}import type {HostRouteModule} from "@pe/agent-contracts";\nexport const host:HostRouteModule={...neutral,${runtime?'reads:(runtime as Pick<HostRouteModule,"reads">).reads,':""}};\n`);



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
await emit(new URL("../../host/src/reads/builtins.generated.ts",import.meta.url),`// Generated by web codegen:routes. Host only.\nimport {closureSchema} from "../../../web/src/route/builtin-closure.ts";\n${hostImports.join("\n")}\nexport const builtins={${hostEntries.join(",")}};\n`);
await emit(new URL("../src/route/links.generated.ts",import.meta.url),`// Generated by codegen:routes. Do not edit.\nimport {routeAddress} from "@pe/agent-contracts";\nexport const routeLinks={${links.join(",")}};\n`);
await emit(new URL("../src/route/builtin-closures.generated.ts",import.meta.url),`// Generated by codegen:routes. Do not edit.\n${closureImports.join("\n")}\nexport const builtinClosures={${closureEntries.join(",")}};\n`);
await emit(new URL("../src/route/builtin-modules.generated.ts",import.meta.url),`// Generated by codegen:routes. Do not edit.\n${browserImports.join("\n")}\nexport const builtinModules={${browserEntries.join(",")}};\n`);
await emit(new URL("../src/route/builtin-typed.generated.ts",import.meta.url),`// Generated by codegen:routes. Do not edit.\n${typedImports.join("\n")}\nexport const typedBuiltins={${typedEntries.join(",")}};\n`);
await emit(new URL("../../../packages/agent-contracts/src/admitted-builtin-keys.ts",import.meta.url),`// Generated by codegen:routes. Do not edit.\nexport const admittedBuiltinKeys=${JSON.stringify(keys)} as readonly string[];\n`);
await emit(new URL("../../host/src/reads/registry.generated.ts",import.meta.url),`// Generated by web codegen:routes. Do not edit.\nimport type {HostRouteModule} from "@pe/agent-contracts";\n${hostReadImports.join("\n")}\nexport const hostReadModules:readonly Pick<HostRouteModule,"reads">[]=[${hostReadEntries.join(",")}];\n`);
const closures = await buildBuiltinClosures(builtinOptions);
const directory = [];
for (const [key, closure] of closures) {
  await emit(
    new URL(`../src/${declarations.get(key)?.folder ?? key}/source-closure.generated.json`, import.meta.url),
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
