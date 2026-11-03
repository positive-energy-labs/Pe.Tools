import type { RouteGraph } from "@pe/agent-contracts";
import { legacyInventory } from "../../../tests/repo-guards/src/unification-2-census";

// Match codegen:routes' module convention; the source census removes migrated JSON modules.
const modules = import.meta.glob<Record<string, unknown>>("./*/graph.ts", { eager: true });
export const legacyGraphs = legacyInventory().graphs.map(({ file, symbol }) => {
  const module = modules[`./${file.split("/src/")[1]}`];
  if (!module || !(symbol in module)) throw Error(`Missing inventoried graph: ${file}#${symbol}`);
  const exported = module[symbol];
  const graph = typeof exported === "function" ? exported(() => ({ thread: "" })) : exported;
  if (!graph || typeof graph !== "object" || !("key" in graph))
    throw Error(`Invalid inventoried graph: ${file}#${symbol}`);
  return graph as RouteGraph<any, any>;
});
