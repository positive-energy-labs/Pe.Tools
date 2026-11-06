import { fansReadRequest, ductsReadRequest, ductsRosterRequestSchema, ductsSheetRequestSchema } from "@pe/agent-contracts";
import { fansSheet } from "./fans.ts";
import { fanRoster, ductSheet } from "./fan-sheet.ts";
import { ductsRoster, ductsNetwork, ductsPricing } from "./ducts.ts";
import type { Read } from "./evaluator.ts";

export const graphRouteIds = ["fans.sheet", "ducts.read", "ducts.roster", "ducts.sheet"];
/** HTTP adapters select a read; composition and freshness belong to the evaluator. */
export function graphRoute(id: string, raw: unknown) {
  const legacy = id === "ducts.roster" || id === "ducts.sheet";
  if (legacy) return { definition: (id === "ducts.roster" ? fanRoster : ductSheet) as Read<any, unknown>,
    args: (id === "ducts.roster" ? ductsRosterRequestSchema : ductsSheetRequestSchema).parse(raw),
    publication: null, readSet: undefined };
  const request = id === "fans.sheet" ? fansReadRequest.parse(raw) : ductsReadRequest.parse(raw);
  const definition = "read" in request
    ? { "ducts.roster": ductsRoster, "ducts.network": ductsNetwork, "ducts.pricing": ductsPricing }[request.read]
    : fansSheet;
  return { definition: definition as Read<any, unknown>, args: request.args, publication: request, readSet: request.readSet };
}
