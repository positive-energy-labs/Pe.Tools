import { pricingResult } from "@pe/ducts-domain/pricing-result";
import { neutralFansWork } from "@pe/agent-contracts";
import type { DuctsDesign } from "@pe/agent-contracts";
import type { Catalogs } from "@pe/ducts-domain/catalog";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import { price, type Priced } from "@pe/ducts-domain/pricing";
import { readiness } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { PricingDelta } from "./pricing-delta.ts";
import { healPlan, rememberHealPlan } from "@pe/ducts-domain/heal";
import { inferJoints, rememberInference } from "@pe/ducts-domain/proximity";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { systemNotes, type SystemNote } from "./system-list-search.ts";
import { systemList } from "./system-list.ts";

interface PricingBase {
  snapshot: DuctSnapshot;
  grids: Grids;
  catalogs: Catalogs;
}
export interface PricingInput extends PricingBase {
  doc: DuctsDesign | null;
}
export interface PricingResult {
  priced: Priced;
  ready: ReturnType<typeof readiness>;
  analysis: {
    heal: ReturnType<typeof healPlan>;
    notes: ReadonlyMap<string, SystemNote>;
    systems: ReturnType<typeof systemList>;
    inference: ReturnType<typeof inferJoints>;
  };
}
export interface PricingRequest {
  id: number;
  base?: PricingBase;
  doc: DuctsDesign | null;
}
export type PricingPayload = Omit<PricingRequest, "id">;
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
      return { id: request.id, result: pricingResult(base.snapshot, base.grids, base.catalogs, request.doc) };
    } catch (error) {
      // The reply carries the message only; the stack stays in the worker console for diagnosis.
      console.error(error);
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
