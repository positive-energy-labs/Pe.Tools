/** Generate Pea's graph projections; host/MCP never load browser implementation modules. */
import { createJiti } from "jiti";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const jiti = createJiti(import.meta.url, {
  alias: { "#/": fileURLToPath(new URL("../src/", import.meta.url)) },
});
const { projectRouteGraph } =
  await jiti.import<typeof import("@pe/agent-contracts")>("@pe/agent-contracts");
for (const route of ["ducts", "families", "family", "schedules"]) {
  const module = await jiti.import<Record<string, Parameters<typeof projectRouteGraph>[0]>>(
    `../src/${route}/graph.ts`,
  );
  const destination = new URL(
    `../../../packages/mcps/src/pea/generated/${route}-graph.json`,
    import.meta.url,
  );
  await mkdir(new URL(".", destination), { recursive: true });
  await writeFile(
    destination,
    `${JSON.stringify(projectRouteGraph(module[`${route}Graph`]!), null, 2)}\n`,
  );
}
