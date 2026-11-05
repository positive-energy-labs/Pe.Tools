import { registerHooks } from "node:module";
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
import { fileURLToPath, pathToFileURL } from "node:url";
const jiti = createJiti(import.meta.url, {
  fsCache: false,
  jsx: { runtime: "automatic" },
  alias: {
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
// Emit/check every admitted builtin without rewriting directory/Pea projections.
const closureOnly = process.argv.includes("--builtin-closure-only");
const closureDestination = process.argv
  .find((arg) => arg.startsWith("--closure-output="))
  ?.slice("--closure-output=".length);
if (closureDestination && !/^(?:[A-Za-z]:[\\/]|\/)/.test(closureDestination))
  throw Error("--closure-output requires an absolute path");
const runtime = process.argv.includes("--runtime");
if (check && runtime)
  throw Error("--check is read-only and cannot use runtime projection flags");
const projections: Record<string, string> = {};
const stale: string[] = [];
async function emit(destination: URL, text: string) {
  if (runtime) {
    projections[fileURLToPath(destination)] = text;
  } else if (check) {
    let current: string | undefined;
    try {
      current = await readFile(destination, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (current?.replaceAll("\r\n", "\n") !== text) stale.push(fileURLToPath(destination));
  } else {
    await mkdir(new URL(".", destination), { recursive: true });
    if (destination.pathname.endsWith("/source-closure.generated.json"))
      writeBuiltinClosurePin(fileURLToPath(destination), text);
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
  const kernel = files.includes("kernel.ts") ? "kernel.ts" : "kernel.tsx";
  const entry = fileURLToPath(new URL(`../src/${key}/${kernel}`, import.meta.url));
  const { module } = await jiti.import<{ module: { data: unknown } }>(entry);
  builtinOptions.push({
    root,
    identityRoot: fileURLToPath(new URL("../../../../", import.meta.url)),
    data: module.data,
    variants: (["web", "pea"] as const).map((client) => ({
      client,
      entry,
    })),
    config: { resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom"] } },

  });
}
const closures = await buildBuiltinClosures(builtinOptions);
if (closureDestination && closures.size !== 1)
  throw Error("--closure-output requires exactly one builtin");
const directory = [];
for (const [key, closure] of closures) {
  await emit(
    closureDestination
      ? pathToFileURL(closureDestination)
      : new URL(`../src/${key}/source-closure.generated.json`, import.meta.url),
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
  for (const [name, exported] of graphs) {
    const graph = (
      name === "chatGraph" ? (exported as Function)(() => ({ thread: "" })) : exported
    ) as Parameters<typeof projectRouteGraph>[0];
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
  throw Error(
    `Generated route artifacts drifted; run from ts/apps/web: node scripts/route-graphs.ts --builtin-closure-only (closures), or codegen:routes (all projections):\n${stale.join("\n")}`,
  );
