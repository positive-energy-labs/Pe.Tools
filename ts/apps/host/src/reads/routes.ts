import { hostReadModules } from "./registry.generated.ts";
import { valueReadRequest, type HostRouteModule } from "@pe/agent-contracts";
import {
  evaluate,
  fingerprint,
  type InputPort,
  type Read,
  type Publications,
  type Publication,
} from "./evaluator.ts";

export const graphRouteIds = ["reads.value"];
function bind<I, O>(
  definition: Read<I, O>,
  args: I,
  publication: {
    subscription: string;
    generation: number;
    release?: boolean;
    readSet?: string;
  } | null = null,
) {
  return {
    name: definition.name,
    key: fingerprint([definition.name, definition.input.parse(args)]),
    args,
    publication,
    readSet: publication?.readSet,
    evaluate: async (port: InputPort) => (await evaluate(definition, args, port)).data,
    publish: (
      owner: Publications,
      id: string,
      generation: number,
      port: InputPort,
      keep?: (publication: Publication<O>) => Promise<() => void>,
    ) => owner.publish(id, generation, definition, args, port, keep),
  };
}
/** Trusted host modules extend the graph without an endpoint or port branch. */
export function readRegistry(modules: readonly Pick<HostRouteModule, "reads" | "leaves">[]) {
  const reads = new Map<string, Read<any, any>>();
  const leaves: Record<string, NonNullable<HostRouteModule["leaves"]>[string]> =
    Object.create(null);
  const serviceInputs = new Set(["native", "resource", "work", "work-scope", "document-mark"]);
  const register = (
    definitions: HostRouteModule["reads"] = {},
    inputs: HostRouteModule["leaves"] = {},
  ) => {
    const incoming = Object.values(definitions),
      names = new Set<string>();
    for (const definition of incoming) {
      if (reads.has(definition.name) || names.has(definition.name))
        throw Error(`Duplicate host read ${definition.name}`);
      names.add(definition.name);
    }
    for (const name of Object.keys(inputs))
      if (
        Object.hasOwn(leaves, name) ||
        serviceInputs.has(name) ||
        name.startsWith("file:") ||
        name.startsWith("local:")
      )
        throw Error(`Duplicate host leaf ${name}`);
    for (const definition of incoming) reads.set(definition.name, definition);
    Object.assign(leaves, inputs);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      for (const definition of incoming)
        if (reads.get(definition.name) === definition) reads.delete(definition.name);
      for (const [name, take] of Object.entries(inputs))
        if (leaves[name] === take) delete leaves[name];
    };
  };
  for (const module of modules) register(module.reads, module.leaves);
  return { reads, leaves, register };
}
export const registeredReads = readRegistry(hostReadModules);
/** HTTP adapters select a read; composition and freshness belong to the evaluator. */
export function graphRoute(id: string, raw: unknown, registry = registeredReads) {
  if (!graphRouteIds.includes(id)) throw Error(`Unknown read door: ${id}`);
  const request = valueReadRequest.parse(raw), definition = registry.reads.get(request.read);
  if (!definition) throw Error(`Host read is not registered: ${request.read}`);
  return bind(definition, definition.input.parse(request.args), request);
}
