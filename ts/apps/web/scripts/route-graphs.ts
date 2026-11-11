import { registerHooks } from "node:module";
import { icons } from "lucide-react";
import { projectWork } from "./host-projection.ts";
import { renderRouteRegistry, type RouteRegistryInput } from "./route-registry.ts";
import {
  HAND_ADDRESSES,
  renderAddressTable,
  type AddressRow,
} from "../../../packages/agent-contracts/scripts/route-address-table.ts";
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
import { readdir, mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { familyFixturesDir } from "../checkout-paths.ts";
import {
  buildBuiltinClosures,
  routeSourceHash,
  writeBuiltinClosurePin,
} from "../route-source-hash.ts";
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
// JSON Schema is the runtime codec projection; retain its field type in generated addresses too.
const schemaType = (schema: any): string => {
  if (schema === true) return "unknown";
  if (schema === false) return "never";
  if ("const" in schema) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((value: unknown) => JSON.stringify(value)).join(" | ") || "never";
  if (schema.anyOf || schema.oneOf) return (schema.anyOf ?? schema.oneOf).map(schemaType).join(" | ");
  if (Array.isArray(schema.type)) return schema.type.map((type: string) => schemaType({ ...schema, type })).join(" | ");
  switch (schema.type) {
    case "null": return "null";
    case "string": return "string";
    case "number": case "integer": return "number";
    case "boolean": return "boolean";
    case "array": return schema.prefixItems ? `[${schema.prefixItems.map(schemaType).join(", ")}]` : `Array<${schema.items ? schemaType(schema.items) : "unknown"}>`;
    case "object": return `{${Object.entries(schema.properties ?? {}).map(([key, value]) => `${JSON.stringify(key)}${schema.required?.includes(key) ? "" : "?"}: ${schemaType(value)}`).join("; ")}}`;
    default: throw Error(`Unsupported generated address schema: ${JSON.stringify(schema)}`);
  }
};
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
const keys=[...declarations.keys()].sort();
const registryRows:RouteRegistryInput[]=[];
const addressRows=new Map<string,AddressRow>(
  Object.keys(HAND_ADDRESSES).map(key=>[key,{key}]));
for (const key of keys) {
  const {folder,file:kernel}=declarations.get(key)!;
  const entry = fileURLToPath(new URL(`../src/${folder}/${kernel}`, import.meta.url));
  const { module, router } = await jiti.import<{ module: { data: unknown }; router?: {contract?:string; dock?:boolean} }>(entry);
  if ("spec" in module) {
    const typed = module as unknown as import("../src/route/typed-route.ts").TypedRoute;
    if (!(typed.data.directory.icon in icons)) throw Error(`${key}: icon ${typed.data.directory.icon} is not a lucide-react icon name`);
    const contract = router?.contract ?? key;
    const { z } = await import("zod");
    const identifier=key.replace(/[^a-zA-Z0-9_$]+([a-zA-Z0-9_$])/g,(_all,part:string)=>part.toUpperCase());
    const agent = typed.spec.agent !== false;
    const fields = Object.entries(typed.spec.fields).map(([key, field]) => {
      const json = z.toJSONSchema(field.schema, { io: "input" });
      const schema = field.role === "subject"
        ? `subjectSchema(${(json.oneOf as {properties?:{ids?:{maxItems?:number}}}[]).find(part=>part.properties?.ids)?.properties!.ids!.maxItems})`
        : `(z.fromJSONSchema(${JSON.stringify(json)}) as z.ZodType<Immutable<${schemaType(json)}>>)`;
      return `${JSON.stringify(key)}: ${agent ? "field" : "personField"}(${schema}${field.initial === undefined ? ".optional()" : `.default(${JSON.stringify(field.initial)})`}, ${JSON.stringify(field.url)})`;
    });
    // A hand address keeps its own fields; the declaration whose key it is still marks it builtin.
    const owner = contract === key ? { module: folder } : {};
    addressRows.set(contract, contract in HAND_ADDRESSES ? { key: contract, ...owner } : { key: contract, ...owner,
      body: `{ path: ${JSON.stringify(typed.data.address)} as const, title: ${JSON.stringify(typed.spec.name)}, fields: {\n${fields.length ? fields.join(",\n")+"," : ""}\nselected: {...${agent ? "field" : "personField"}(focusSelectionSchema,"replace"),agent:undefined}\n}${agent ? `, agent: { policy: ${JSON.stringify(typed.spec.subject ? `Choose ${typed.spec.subject.noun} through ${typed.spec.subject.field}, using the module's local identities.` : "Use the route fields as declared.")} }` : ""} }` });
    // Preserve the actual imported Work export, including refinements and reconciliation.
    // JSON Schema cannot carry that authority; a second handwritten host declaration would drift.
    let work: RouteRegistryInput["work"];
    if(typed.spec.edits) {
      const workDestination = new URL(`../../../packages/agent-contracts/src/generated/${key}-work.ts`, import.meta.url);
      const projected=await projectWork(entry,typed,fileURLToPath(workDestination),`${identifier}RouteState`,
        specifier=>jiti.import<Record<string,{schema?:unknown}>>(specifier));
      await emit(workDestination,`// Generated from ${key}/route.ts by codegen:routes. Do not edit.\n${projected.definition}`);
      work={stateExport:`${identifier}RouteState`,file:`../../../packages/agent-contracts/src/generated/${key}-work.ts`,properties:projected.properties};
    }
    registryRows.push({key,folder,address:typed.data.address,contract,dock:router?.dock === true,
      ...(typed.spec.host ? {host:typed.spec.host} : {}),...(work ? {work} : {})});
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
await emit(new URL("../../../packages/agent-contracts/src/routes/table.generated.ts",import.meta.url),renderAddressTable([...addressRows.values()]));
await emit(new URL("../../host/src/routes.generated.ts",import.meta.url),renderRouteRegistry(registryRows));
const closures = await buildBuiltinClosures(builtinOptions);
const directory = [];
for (const [key, closure] of closures) {
  await emit(
    new URL(`../src/${declarations.get(key)!.folder}/source-closure.generated.json`, import.meta.url),
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
  if (closures.has(folder.name) || [...declarations.values()].some(entry => entry.folder === folder.name)) continue;
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
