/** Host workflows a route runs for its document, and the plan lane for a plan/apply pair. */
import {
  type ActionBases,
  type ExecutionTarget,
  type SemanticActionKey,
  type WorkKey,
} from "@pe/agent-contracts";
import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import {
  type ApplyPlan,
  type Ctx,
  type EntityPage,
  type EntityReading,
  type HeldRow,
  type PlanEntry,
} from "./manifest";

/** `$schema` is an absolute URL on whichever host served it; the path is what names the library. */
export const isSpecOf = (schema: string | null | undefined, path: string | readonly string[]) => {
  if (!schema) return false;
  try {
    return [path].flat().includes(new URL(schema, "http://host").pathname);
  } catch {
    return false;
  }
};

export const documentOf = (ctx: { target: ExecutionTarget }) => {
  if (ctx.target.kind !== "document") throw Error("pick a document");
  return ctx.target.ref;
};

/** A host workflow's result, or its refusal as an error. */
export const workflow = async (
  key: SemanticActionKey,
  input: Record<string, unknown>,
  ctx: { target: ExecutionTarget },
  bases?: ActionBases,
): Promise<Record<string, unknown>> => {
  const action = await runSemanticAction(key, input, documentOf(ctx), bases);
  if (action.state !== "succeeded")
    throw Error(
      "error" in action && action.error ? String(action.error) : `${key} ${action.state}`,
    );
  return (action as unknown as { result: Record<string, unknown> }).result;
};

/**
 * The plan lane for a plan/apply workflow pair (dogma law 14): `plan` returns `{ plan }` and
 * mutates nothing, `apply` requires the hashes it returned. The result is one plan or one per
 * subject; apply sends each included row's hash as `expectedPlanHashes`.
 * `authored` is what the route's Work adds to both; with it, plan reads against that revision.
 */
export const admissionPlan = <W, R extends string, P>(
  keys: { plan: SemanticActionKey; apply: SemanticActionKey },
  row: (plan: unknown) => PlanEntry,
  authored?: (work: W) => { executionOptions?: unknown } & Record<string, unknown>,
  /** Who the plan result says held rows back, named by the sheet's own rows. */
  held?: (result: Record<string, unknown>, entries: readonly PlanEntry[]) => readonly HeldRow[],
): ApplyPlan<W, R, P> => {
  const workOf = (
    ctx: Ctx<W, R | EntityReading, P & EntityPage>,
  ): { input: { executionOptions?: unknown }; bases?: ActionBases } => {
    if (!authored) return { input: {} };
    const { doc, key, revision } = ctx.work;
    if (!doc || revision === null) throw Error("author the route's Work first");
    return { input: authored(doc), bases: { work: { key: key as WorkKey, revision } } };
  };
  return {
    read: async (ctx, source) => {
      const { input, bases } = workOf(ctx);
      const result = await workflow(keys.plan, { source, ...input }, ctx, bases);
      const entries = [result.plan]
        .flat()
        .map((plan) => ({ ...row(plan), plan: String(result.id) }));
      const rows = held?.(result, entries) ?? [];
      return rows.length ? { entries, held: rows } : { entries };
    },
    // The plan sealed the source and options; apply names that plan and the hashes it confirms.
    apply: async (ctx, included) => {
      for (const input of byPlan(included)) await workflow(keys.apply, input, ctx);
    },
  };
};

export const byPlan = (included: readonly PlanEntry[]) => {
  const plans = new Map<string, Record<string, string>>();
  for (const row of included) {
    if (!row.plan) throw Error(`the planned row for ${row.name} names no plan`);
    (plans.get(row.plan) ?? plans.set(row.plan, {}).get(row.plan)!)[row.hashKey ?? row.id] =
      row.planHash;
  }
  return [...plans].map(([plan, expectedPlanHashes]) => ({ plan, expectedPlanHashes }));
};
