import type { DuctsRouteDocument } from "@pe/agent-contracts";
import type { Catalogs } from "@pe/ducts-domain/catalog";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import { price, type Priced } from "@pe/ducts-domain/pricing";
import { readiness } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { PricingDelta } from "./pricing-delta";
import { healPlan, rememberHealPlan } from "@pe/ducts-domain/heal";
import { inferJoints, rememberInference } from "@pe/ducts-domain/proximity";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { systemsNeedingFix } from "./system-list-search";
import { systemList } from "./system-list";

interface PricingBase {
  snapshot: DuctSnapshot;
  grids: Grids;
  catalogs: Catalogs;
}
export interface PricingInput extends PricingBase {
  doc: DuctsRouteDocument | null;
  revision: number | null;
  epoch: number;
  documentKey: string | null;
}
export interface PricingResult {
  priced: Priced;
  ready: ReturnType<typeof readiness>;
  analysis: {
    heal: ReturnType<typeof healPlan>;
    needsFix: ReadonlySet<string>;
    systems: ReturnType<typeof systemList>;
    inference: ReturnType<typeof inferJoints>;
  };
}
export interface PricingObservation {
  input: PricingInput;
  result: PricingResult;
}
export interface PricingRequest {
  id: number;
  base?: PricingBase;
  doc: DuctsRouteDocument | null;
}
export type PricingResponse = { id: number } & (
  | { result: PricingResult }
  | { error: string }
  | { delta: PricingDelta | null }
);

/** Retain base identities inside the worker so the domain's survey/solve caches survive Work edits. */
export function pricingJob() {
  let base: PricingBase | undefined;
  return (request: PricingRequest): PricingResponse => {
    try {
      if (request.base) base = request.base;
      if (!base) throw Error("Pricing has no snapshot or tables");
      const priced = price(base.snapshot, base.grids, request.doc, base.catalogs);
      const heal = healPlan(base.snapshot, request.doc);
      return {
        id: request.id,
        result: {
          priced,
          ready: readiness(base.snapshot, request.doc),
          analysis: {
            heal,
            needsFix: systemsNeedingFix(priced, request.doc, heal),
            systems: systemList(priced.snapshot, priced),
            inference: inferJoints(
              base.snapshot,
              1,
              withStoredRulings(request.doc, base.snapshot.store),
            ),
          },
        },
      };
    } catch (error) {
      return { id: request.id, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

/** Install exact worker evidence before React can ask synchronous projection helpers for it. */
export function rememberAnalysis(input: PricingInput, result: PricingResult) {
  rememberHealPlan(input.snapshot, input.doc, result.analysis.heal);
  rememberInference(
    input.snapshot,
    1,
    withStoredRulings(input.doc, input.snapshot.store),
    result.analysis.inference,
  );
}

export const samePricingInput = (a: PricingInput, b: PricingInput) =>
  a.snapshot === b.snapshot &&
  a.grids === b.grids &&
  a.catalogs === b.catalogs &&
  a.doc === b.doc &&
  a.revision === b.revision &&
  a.epoch === b.epoch &&
  a.documentKey === b.documentKey;
