import { admittedBuiltinKeys } from "../../../packages/agent-contracts/src/admitted-builtin-keys";
import type { RouteGraph } from "@pe/agent-contracts";

// Match codegen:routes export discovery; admitted builtins use their closure witness.
const modules = import.meta.glob<Record<string, unknown>>("./*/graph.ts", { eager: true });
export const legacyGraphs = Object.values(modules)
  .flatMap((module) =>
    Object.entries(module)
      .filter(([symbol]) => symbol.endsWith("Graph"))
      .map(([, exported]) => {
        const graph = typeof exported === "function" ? exported(() => ({ thread: "" })) : exported;
        if (!graph || typeof graph !== "object" || !("key" in graph))
          throw Error("Invalid exported route graph");
        return graph as RouteGraph<any, any>;
      }),
  )
  .filter((graph) => !(admittedBuiltinKeys as readonly string[]).includes(graph.key));
