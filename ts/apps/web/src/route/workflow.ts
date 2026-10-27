/** Presentation of optional previews over the host's sealed command intent. */
import { type ExecutionTarget, type SemanticActionKey } from "@pe/agent-contracts";
import { invokeBoundCommand } from "./presentation";
import { actionResult } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import type { ApplyPlan, HeldRow, PlanEntry } from "./entity-route";

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

/** Selection from one sealed preview; the host validates its exact original plan. */
export function confirmedPlan(included: readonly PlanEntry[]) {
  const plan = included[0]?.plan;
  if (!plan || included.some((row) => row.plan !== plan))
    throw Error("Preview has no single sealed plan");
  return { plan, include: included.map((row) => row.hashKey ?? row.id) };
}

/**
 * Preview draws the host's sealed plan. Apply names that plan and the selected row identities;
 * the host retains its source and hashes.
 */
export const admissionPlan = <W, R extends string, P>(
  keys: { plan: SemanticActionKey; apply: SemanticActionKey },
  row: (plan: unknown) => PlanEntry,
  /** Who the plan result says held rows back, named by the sheet's own rows. */
  held?: (result: Record<string, unknown>, entries: readonly PlanEntry[]) => readonly HeldRow[],
): ApplyPlan<W, R, P> => {
  return {
    direct: async (ctx, source) => {
      actionResult(await invokeBoundCommand(ctx.commands, keys.apply, { source, include: "all" }));
    },
    read: async (ctx, source) => {
      const result = actionResult(
        await invokeBoundCommand(ctx.commands, keys.plan, { source }),
      ) as Record<string, unknown>;
      const entries = [result.plan]
        .flat()
        .map((plan) => ({ ...row(plan), plan: String(result.id) }));
      const rows = held?.(result, entries) ?? [];
      return rows.length ? { entries, held: rows } : { entries };
    },
    // The plan sealed the source and options; apply names that plan and the hashes it confirms.
    apply: async (ctx, included) => {
      actionResult(await invokeBoundCommand(ctx.commands, keys.apply, confirmedPlan(included)));
    },
  };
};
