import {
  HostCallError,
  geometryOverBudget,
  geometryBudgetSentence,
  type GeometryOverBudget,
} from "@pe/host-contracts/operation-types";

/** A geometry pane supplies a separate, bounded link-boxes reading of its subjects.
 * The kernel never constructs an overview by unioning detailed subject captures. */
export interface GeometryDeclaration<T> {
  overview: () => Promise<T>;
  narrow: string;
}

export function geometryBudget(error: unknown): GeometryOverBudget | null {
  return geometryOverBudget(error instanceof HostCallError ? error.problem : null);
}

export const budgetSentence = geometryBudgetSentence;

/** Only the initiating action executes retries. No timers, warming or override door. */
export async function readGeometry<T>(
  declaration: GeometryDeclaration<T>,
  subject: "all" | "picked",
  representation: string,
  capture: (representation: string) => Promise<T>,
): Promise<{ value: T; notice: string | null }> {
  if (subject === "all")
    return {
      value: await declaration.overview(),
      notice: `Showing the link-boxes overview of all subjects. ${declaration.narrow}`,
    };
  const reasons: string[] = [];
  let requested = representation;
  for (;;) {
    try {
      return {
        value: await capture(requested),
        notice: reasons.length
          ? `${reasons.join(" ")} Showing link boxes. ${declaration.narrow}`
          : null,
      };
    } catch (error) {
      const budget = geometryBudget(error);
      if (!budget) throw error;
      reasons.push(budgetSentence(budget));
      if (requested === "meshes" && budget.representation === "meshes") {
        requested = "link-boxes";
        continue;
      }
      return {
        value: await declaration.overview(),
        notice: `${reasons.join(" ")} Showing the link-boxes overview. ${declaration.narrow}`,
      };
    }
  }
}
