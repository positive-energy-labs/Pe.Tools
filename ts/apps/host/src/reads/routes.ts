import {
  fansReadRequest,
  ductsReadRequest,
  ductsRosterRequestSchema,
  ductsSheetRequestSchema,
} from "@pe/agent-contracts";
import { fansSheet } from "./fans.ts";
import { fanRoster, ductSheet } from "./fan-sheet.ts";
import { ductsRoster, ductsNetwork, ductsPricing } from "./ducts.ts";
import { evaluate, type InputPort, type Read, type Publications } from "./evaluator.ts";

export const graphRouteIds = ["fans.sheet", "ducts.read", "ducts.roster", "ducts.sheet"];
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
    args,
    publication,
    readSet: publication?.readSet,
    evaluate: async (port: InputPort) => (await evaluate(definition, args, port)).data,
    publish: (owner: Publications, id: string, generation: number, port: InputPort) =>
      owner.publish(id, generation, definition, args, port),
  };
}
/** HTTP adapters select a read; composition and freshness belong to the evaluator. */
export function graphRoute(id: string, raw: unknown) {
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
