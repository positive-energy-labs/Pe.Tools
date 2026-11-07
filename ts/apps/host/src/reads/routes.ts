import {hostReadModules} from "./registry.generated.ts";
import {valueReadRequest,type HostRouteModule} from "@pe/agent-contracts";
import {
  fansReadRequest,
  ductsReadRequest,
  ductsRosterRequestSchema,
  ductsSheetRequestSchema,
} from "@pe/agent-contracts";
import { fansSheet } from "./fans.ts";
import { fanRoster, ductSheet } from "./fan-sheet.ts";
import { ductsRoster, ductsNetwork, ductsPricing } from "./ducts.ts";
import { evaluate, fingerprint, type InputPort, type Read, type Publications, type Publication } from "./evaluator.ts";

export const graphRouteIds = ["reads.value","fans.sheet", "ducts.read", "ducts.roster", "ducts.sheet"];
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
    publish: (owner: Publications, id: string, generation: number, port: InputPort,
      keep?: (publication: Publication<O>) => Promise<() => void>) =>
      owner.publish(id, generation, definition, args, port, keep),
  };
}
/** Trusted host modules extend the graph without an endpoint or port branch. */
export function readRegistry(modules:readonly Pick<HostRouteModule,"reads"|"leaves">[]) {
  const reads=new Map<string,Read<any,any>>();
  for(const module of modules) for(const read of Object.values(module.reads ?? {})) {
    if(reads.has(read.name)&&reads.get(read.name)!==read) throw Error(`Duplicate host read ${read.name}`);
    reads.set(read.name,read);
  }
  return {reads};
}
export const registeredReads=readRegistry(hostReadModules);
/** HTTP adapters select a read; composition and freshness belong to the evaluator. */
export function graphRoute(id: string, raw: unknown, registry=registeredReads) {
  if(id === "reads.value") {
    const request=valueReadRequest.parse(raw),definition=registry.reads.get(request.read);
    if(!definition) throw Error(`Host read is not registered: ${request.read}`);
    return bind(definition,definition.input.parse(request.args),request);
  }
  if (id === "ducts.roster") return bind(fanRoster, ductsRosterRequestSchema.parse(raw));
  if (id === "ducts.sheet") return bind(ductSheet, ductsSheetRequestSchema.parse(raw));
  if (id === "fans.sheet") {
    const request = fansReadRequest.parse(raw);
    return bind(fansSheet, request.args, request);
  }
  const request = ductsReadRequest.parse(raw);
  switch (request.read) {
    case "ducts.roster":
      return bind(ductsRoster, request.args, request);
    case "ducts.network":
      return bind(ductsNetwork, request.args, request);
    case "ducts.pricing":
      return bind(ductsPricing, request.args, request);
  }
}
