import { registerHooks } from "node:module";
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
import { routeSourceHash } from "../route-source-hash.ts";
import { readdir, mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const jiti = createJiti(import.meta.url, {
  fsCache: false,
  jsx: { runtime: "automatic" },
  alias: {
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
await import("./captures-artifact.ts");
const check = process.argv.includes("--check");
const stale: string[] = [];
async function emit(destination: URL, text: string) {
  if (check) {
    let current: string | undefined;
    try { current = await readFile(destination, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (current?.replaceAll("\r\n", "\n") !== text) stale.push(fileURLToPath(destination));
  } else {
    await mkdir(new URL(".", destination), { recursive: true });
    await writeFile(destination, text);
  }
}
const directory = [];
for (const folder of (await readdir(new URL("../src/", import.meta.url), { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))) {
  const files = await readdir(new URL(`../src/${folder.name}/`, import.meta.url));
  if (!files.includes("graph.ts")) continue;
  const module = await jiti.import<Record<string, unknown>>(`../src/${folder.name}/graph.ts`);
  const graphs = Object.entries(module).filter(([name]) => name.endsWith("Graph"));
  for (const [name, exported] of graphs) {
    const graph = (
      name === "chatGraph" ? (exported as Function)(() => ({ thread: "" })) : exported
    ) as Parameters<typeof projectRouteGraph>[0];
    if (!graph || typeof graph !== "object" || !graph.key) continue;
    if (!graph.directory) throw Error(`${graph.key} has no directory declaration`);
    graph.moduleHash = routeSourceHash(await readFile(new URL(`../src/${folder.name}/graph.ts`, import.meta.url)));
    directory.push({
      key: graph.key,
      directory: graph.directory,
      moduleHash: routeSourceHash(await readFile(new URL(`../src/${folder.name}/graph.ts`, import.meta.url))),
    });
    const destination = new URL(
      `../../../packages/mcps/src/pea/generated/${graph.key}-graph.json`,
      import.meta.url,
    );
    await emit(destination, `${JSON.stringify(projectRouteGraph(graph), null, 2)}\n`);
  }
}
await emit(
  new URL("../../../packages/agent-contracts/src/generated/route-directory.ts", import.meta.url),
  `// Generated from web route graphs by codegen:routes.\nimport type { RouteDirectory } from "../route-graph.ts";\nexport const routeDirectory: readonly {key: string; directory: RouteDirectory; moduleHash: string}[] = ${JSON.stringify(directory, null, 2)};\n`,
);
console.log(`Projected ${directory.length} route graphs`);

if (stale.length) throw Error(`Generated route artifacts drifted; regenerate codegen:routes:\n${stale.join("\n")}`);
