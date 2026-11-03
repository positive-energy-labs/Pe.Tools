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
import { buildBuiltinClosure, routeSourceHash } from "../route-source-hash.ts";
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
// A bounded producer probe can emit/check one builtin without rewriting projections.
const closureOnly = process.argv.includes("--builtin-closure-only");
const closureDestination = process.argv
  .find((arg) => arg.startsWith("--closure-output="))
  ?.slice("--closure-output=".length);
if (closureDestination && !/^(?:[A-Za-z]:[\\/]|\/)/.test(closureDestination))
  throw Error("--closure-output requires an absolute path");
const stale: string[] = [];
async function emit(destination: URL, text: string) {
  if (check) {
    let current: string | undefined;
    try {
      current = await readFile(destination, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
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
  if (folder.name === "captures") {
    const { capturesGraph } = await jiti.import<typeof import("../src/captures/graph.ts")>(
      "../src/captures/graph.ts",
    );
    const root = fileURLToPath(new URL("../", import.meta.url));
    const host = JSON.parse(
      await readFile(new URL("../../host/package.json", import.meta.url), "utf8"),
    );
    const closure = await buildBuiltinClosure({
      root,
      identityRoot: fileURLToPath(new URL("../../../../", import.meta.url)),
      data: capturesGraph,
      hostVersion: host.version,
      variants: [
        {
          client: "web",
          entry: fileURLToPath(new URL("../src/captures/kernel.ts", import.meta.url)),
        },
        {
          client: "pea",
          entry: fileURLToPath(new URL("../src/captures/kernel.ts", import.meta.url)),
        },
      ],
      config: { resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom"] } },
      inputs: [
        "../vite.config.ts",
        "../tsconfig.json",
        "../route-source-hash.ts",
        "../route-module-hash.ts",
        "../../host/package.json",
        "../../../pnpm-lock.yaml",
        "../../../package.json",
        "../../../packages/agent-contracts/src/route-kernel-data.ts",
        "../../../packages/agent-contracts/src/route-module.ts",
      ].map((path) => fileURLToPath(new URL(path, import.meta.url))),
    });
    await emit(
      closureDestination
        ? pathToFileURL(closureDestination)
        : new URL("../src/captures/source-closure.generated.json", import.meta.url),
      canonicalRouteJson(closure) + "\n",
    );
    if (closureOnly) continue;
    directory.push({
      key: capturesGraph.key,
      directory: projectKernelDirectory(capturesGraph),
      moduleHash: closure.fingerprint,
    });
    await emit(
      new URL("../../../packages/mcps/src/pea/generated/captures-graph.json", import.meta.url),
      `${JSON.stringify(capturesGraph, null, 2)}\n`,
    );
    continue;
  }
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
      moduleHash: routeSourceHash(
        await readFile(new URL(`../src/${folder.name}/graph.ts`, import.meta.url)),
      ),
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
    `// Generated from web route graphs by codegen:routes.\nimport type { RouteDirectory } from "../route-graph.ts";\nexport const routeDirectory: readonly {key: string; directory: RouteDirectory; moduleHash: string}[] = ${JSON.stringify(directory, null, 2)};\n`,
  );
console.log(`Projected ${directory.length} route graphs`);

if (stale.length)
  throw Error(`Generated route artifacts drifted; regenerate codegen:routes:\n${stale.join("\n")}`);
