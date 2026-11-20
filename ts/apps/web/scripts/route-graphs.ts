import { productDependencyChanges, renderProductAssembly } from "./product-assembly.ts";
import { execFileSync, spawnSync } from "node:child_process";
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
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { familyFixturesDir } from "../checkout-paths.ts";
import {
  routeFolderCandidates,
  routeStartupSourceHash,
  writeRouteStartupReceipt,
} from "../route-startup.ts";
import { buildBuiltinClosures, writeBuiltinClosurePin } from "../route-source-hash.ts";
const check = process.argv.includes("--check");
// Write every builtin closure (untracked build output) without rewriting tracked projections.
const closureOnly = process.argv.includes("--builtin-closure-only");
const runtime = process.argv.includes("--runtime");
const productsOnly = process.argv.includes("--products-only");
if (productsOnly && (check || runtime || closureOnly))
  throw Error("--products-only writes the product assembly and workspace links");
if (check && runtime) throw Error("--check is read-only and cannot use runtime projection flags");
// JSON Schema is the runtime codec projection; retain its field type in generated addresses too.
const schemaType = (schema: any): string => {
  if (schema === true) return "unknown";
  if (schema === false) return "never";
  if ("const" in schema) return JSON.stringify(schema.const);
  if (schema.enum)
    return schema.enum.map((value: unknown) => JSON.stringify(value)).join(" | ") || "never";
  if (schema.anyOf || schema.oneOf)
    return (schema.anyOf ?? schema.oneOf).map(schemaType).join(" | ");
  if (Array.isArray(schema.type))
    return schema.type.map((type: string) => schemaType({ ...schema, type })).join(" | ");
  switch (schema.type) {
    case "null":
      return "null";
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return schema.prefixItems
        ? `[${schema.prefixItems.map(schemaType).join(", ")}]`
        : `Array<${schema.items ? schemaType(schema.items) : "unknown"}>`;
    case "object": {
      const properties = `{${Object.entries(schema.properties ?? {})
        .map(
          ([key, value]) =>
            `${JSON.stringify(key)}${schema.required?.includes(key) ? "" : "?"}: ${schemaType(value)}`,
        )
        .join("; ")}}`;
      return schema.additionalProperties
        ? `${properties} & Record<string, ${schemaType(schema.additionalProperties)}>`
        : properties;
    }
    default:
      throw Error(`Unsupported generated address schema: ${JSON.stringify(schema)}`);
  }
};
const projections: Record<string, string> = {};
const stale: string[] = [];
// Every full run (codegen:routes or --runtime) leaves the content-hashed receipt a source host start
// reads instead of producing (source-closures.ts). Hashed before producing; see writeRouteStartupReceipt.
const checkout = fileURLToPath(new URL("../../../../", import.meta.url));
const sourceHashBefore = check || closureOnly ? undefined : routeStartupSourceHash(checkout);
async function emit(destination: URL, text: string) {
  const closure = destination.pathname.endsWith("/source-closure.generated.json");
  if (closureOnly && !closure) return;
  projections[fileURLToPath(destination)] = text;
  if (runtime) return;
  if (check) {
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
// A product can author a route with its own handles. Its command rows must exist before loading that route.
if (!closureOnly) {
  const assembly = renderProductAssembly(checkout);
  for (const [file, text] of Object.entries(assembly.outputs))
    await emit(pathToFileURL(join(checkout, file)), text);
  if (!runtime) {
    for (const { file, text } of productDependencyChanges(checkout, assembly.dependencies)) {
      const destination = join(checkout, file);
      if (check) stale.push(destination);
      else await writeFile(destination, text);
    }
  }
}
if (productsOnly) process.exit(0);
if (!closureOnly && !runtime && stale.length === 0)
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL("../../../scripts/refresh-command-table.ts", import.meta.url)),
      ...(check ? ["--check"] : []),
    ],
    { stdio: "inherit" },
  );
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
    "@pe/web-kernel/host/runtime": fileURLToPath(
      new URL("./route-projection-runtime.ts", import.meta.url),
    ),
    "#/": fileURLToPath(new URL("../src/", import.meta.url)),
  },
});
const { canonicalRouteJson, projectKernelDirectory } =
  await jiti.import<typeof import("@pe/agent-contracts")>("@pe/agent-contracts");
const { textCodec } = await jiti.import<
  typeof import("../../../packages/agent-contracts/src/route-field.ts")
>("../../../packages/agent-contracts/src/route-field.ts");
const { listSearchCodec } = await jiti.import<
  typeof import("../../../packages/agent-contracts/src/list-search.ts")
>("../../../packages/agent-contracts/src/list-search.ts");
const root = fileURLToPath(new URL("../", import.meta.url));
const builtinOptions = [];
// `folder` is the route directory relative to `apps/web/src/`: one segment for a web route, and
// `../../../products/<product>/web` for a product's (ADR 0046).
const webSource = fileURLToPath(new URL("../src/", import.meta.url));
const discovered = routeFolderCandidates(checkout).map((path) =>
  relative(webSource, path).replaceAll("\\", "/"),
);
const declarations = new Map<string, { folder: string; module: { data: { key: string } } }>();
for (const folder of discovered) {
  const file = new URL(`../src/${folder}/route.ts`, import.meta.url);
  const text = await readFile(file, "utf8").catch(() => "");
  if (/export\s+(?:const|let)\s+module\b/.test(text)) {
    const { module } = await jiti.import<{ module: { data: { key: string } } }>(
      fileURLToPath(file),
    );
    if (declarations.has(module.data.key)) throw Error(`Duplicate route module ${module.data.key}`);
    declarations.set(module.data.key, { folder, module });
  }
}
const keys = [...declarations.keys()].sort();
const registryFile = new URL("../../host/src/routes.generated.ts", import.meta.url);
const registryRows: RouteRegistryInput[] = [];
const addressRows = new Map<string, AddressRow>(
  Object.keys(HAND_ADDRESSES).map((key) => [key, { key }]),
);
for (const key of keys) {
  const { folder } = declarations.get(key)!;
  const entry = fileURLToPath(new URL(`../src/${folder}/route.ts`, import.meta.url));
  const { module, router } = await jiti.import<{
    module: { data: unknown };
    router?: { contract?: string };
  }>(entry);
  if ("spec" in module) {
    const typed = module as unknown as import("@pe/web-kernel/route/typed-route").TypedRoute;
    if (!(typed.data.directory.icon in icons))
      throw Error(`${key}: icon ${typed.data.directory.icon} is not a lucide-react icon name`);
    const contract = router?.contract ?? key;
    const { z } = await import("zod");
    const identifier = key.replace(/[^a-zA-Z0-9_$]+([a-zA-Z0-9_$])/g, (_all, part: string) =>
      part.toUpperCase(),
    );
    const agent = typed.spec.agent !== false;
    const fields = Object.entries(typed.spec.fields).map(([key, field]) => {
      const json = z.toJSONSchema(field.schema, { io: "input" });
      // A scene pose's geometric refinements cannot survive JSON Schema projection.
      const schema =
        key === "sceneView"
          ? "sceneViewSchema"
          : field.role === "subject"
            ? `subjectSchema(${(json.oneOf as { properties?: { ids?: { maxItems?: number } } }[]).find((part) => part.properties?.ids)?.properties!.ids!.maxItems})`
            : `(z.fromJSONSchema(${JSON.stringify(json)}) as z.ZodType<Immutable<${schemaType(json)}>>)`;
      const codecName =
        field.codec === listSearchCodec
          ? "listSearchCodec"
          : field.codec === textCodec
            ? "textCodec"
            : null;
      if (field.codec && !codecName)
        throw Error(`${key}: the declared field codec has no address projection`);
      const codec = codecName ? `, codec: ${codecName}` : "";
      const projected = `${agent ? "field" : "personField"}(${schema}${field.initial === undefined ? ".optional()" : `.default(${JSON.stringify(field.initial)})`}, ${JSON.stringify(field.url)})`;
      return `${JSON.stringify(key)}: ${field.share === false || codec ? `{ ...${projected}${field.share === false ? ", share: false" : ""}${codec} }` : projected}`;
    });
    // A hand address keeps its own fields; the declaration whose key it is still marks it builtin.
    const owner = contract === key ? { module: folder } : {};
    addressRows.set(
      contract,
      contract in HAND_ADDRESSES
        ? { key: contract, ...owner }
        : {
            key: contract,
            ...owner,
            body: `{ path: ${JSON.stringify(typed.data.address)} as const, title: ${JSON.stringify(typed.spec.name)}, fields: {\n${fields.length ? fields.join(",\n") + "," : ""}\nselected: {...${agent ? "field" : "personField"}(focusSelectionSchema,"replace"),agent:undefined}\n}${agent ? `, agent: { policy: ${JSON.stringify(typed.spec.subject ? `Choose ${typed.spec.subject.noun} through ${typed.spec.subject.field}, using the module's local identities.` : "Use the route fields as declared.")} }` : ""} }`,
          },
    );
    // Preserve the actual imported Work export, including refinements and reconciliation.
    // JSON Schema cannot carry that authority; a second handwritten host declaration would drift.
    // The registry binds the Work where route.ts imports it (its own directory, or contracts), so
    // contracts never receive a projection that imports an app.
    let work: RouteRegistryInput["work"];
    if (typed.spec.edits) {
      const name = `${identifier}Work`;
      const projected = await projectWork(
        entry,
        typed,
        fileURLToPath(registryFile),
        name,
        (specifier) => jiti.import<Record<string, { schema?: unknown }>>(specifier),
        false,
      );
      work = { name, definition: projected.definition, properties: projected.properties };
    }
    const pageSchemas = new Set(
      Object.values(typed.data.fields).flatMap((field) =>
        "schema" in field ? [field.schema] : [],
      ),
    );
    registryRows.push({
      key,
      folder,
      schemas: Object.fromEntries(
        [...pageSchemas].map((id) => {
          const schema = typed.host.schemas[id];
          if (!schema) throw Error(`Route ${key}: missing field schema ${id}`);
          return [id, z.toJSONSchema(schema, { io: "input" })];
        }),
      ),
      ...(typed.spec.host ? { host: typed.spec.host } : {}),
      ...(work ? { work } : {}),
    });
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
await emit(
  new URL("../../../packages/agent-contracts/src/routes/table.generated.ts", import.meta.url),
  renderAddressTable([...addressRows.values()]),
);
await emit(registryFile, renderRouteRegistry(registryRows));
const closures = await buildBuiltinClosures(builtinOptions);
const directory = [];
for (const [key, closure] of closures) {
  await emit(
    new URL(
      `../src/${declarations.get(key)!.folder}/source-closure.generated.json`,
      import.meta.url,
    ),
    canonicalRouteJson(closure) + "\n",
  );
  if (closureOnly) continue;
  const data = closure.envelope.data;
  directory.push({ key, directory: projectKernelDirectory(data) });
}
if (!closureOnly)
  await emit(
    new URL("../../../packages/agent-contracts/src/generated/route-directory.ts", import.meta.url),
    `// Generated from web route graphs by codegen:routes.\nimport type { RouteDirectory } from "../route-graph.ts";\nexport const routeDirectory: readonly {key: string; directory: RouteDirectory}[] = ${JSON.stringify(directory, null, 2)};\n`,
  );
if (sourceHashBefore) writeRouteStartupReceipt(checkout, sourceHashBefore, projections);
console.log(runtime ? JSON.stringify(projections) : `Projected ${directory.length} route graphs`);
// The C# launch rows project the address table and directory just written; a child process reads
// them from disk (this process holds the stale modules). One step owns everything a route needs.
if (!runtime && !closureOnly) {
  const links = fileURLToPath(
    new URL("../../../packages/agent-contracts/scripts/route-links-cs.ts", import.meta.url),
  );
  if (
    spawnSync(process.execPath, [links, ...(check ? ["--check"] : [])], { stdio: "inherit" })
      .status !== 0
  )
    stale.push("dotnet/Pe.App/Host/PeRoutes.generated.cs (route-links-cs.ts)");
}

if (stale.length)
  throw Error(`Generated route artifacts drifted; run codegen:routes:\n${stale.join("\n")}`);
