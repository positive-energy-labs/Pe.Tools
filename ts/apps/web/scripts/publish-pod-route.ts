import {createJiti} from "jiti";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publishPodRoute } from "../pod-route-authoring.ts";
import type { RouteGraphJson } from "../../../packages/agent-contracts/src/route-kernel-data.ts";

/** node scripts/publish-pod-route.ts <absolute-pod-directory> <route-slug> */
const [directory, slug] = process.argv.slice(2);
if (!directory || !slug) throw Error("Expected Pod directory and route slug");
const root = resolve(directory);
const entry = join(root, "routes", slug, "module.ts");
const { module } = (await createJiti(import.meta.url,{fsCache:false}).import(entry)) as {
  module: { data: RouteGraphJson };
};
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const contractPaths = [
  "ts/packages/agent-contracts/src/route-kernel-data.ts",
  "ts/packages/agent-contracts/src/route-kernel-bodies.ts",
  "ts/packages/agent-contracts/src/route-kernel-admission.ts",
  "ts/packages/host-contracts/src/generated/host-catalog.generated.ts",
];
const result = await publishPodRoute({
  entry,
  root,
  data: module.data,
  slug,
  name: module.data.name,
  description: module.data.directory.summary,
  contracts: await Promise.all(
    contractPaths.map(async (id) => ({
      id,
      bytes: new Uint8Array(await readFile(join(repo, id))),
    })),
  ),
});
const manifestFile = join(root, "pod.json");
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
// Strict manifest admission rejects legacy entries rather than silently converting them.
const { podRouteDeclarationSchema } =
  await import("../../../packages/host-contracts/src/pod-route.ts");
const routes = (manifest.routes ?? []).map((row: unknown) => podRouteDeclarationSchema.parse(row));
manifest.routes = [
  ...routes.filter((row: { artifact: string }) => row.artifact !== result.declaration.artifact),
  result.declaration,
];
await writeFile(join(root, result.declaration.artifact), result.bytes);
await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(result.declaration));
