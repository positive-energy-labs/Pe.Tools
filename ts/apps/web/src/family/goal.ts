import type { FamilyDraft } from "@pe/agent-contracts";
import type { Closer, Goal } from "@pe/agent-contracts/slots";

/*
 * The doc-lab acceptance as the route's Goal (routes MAP, "/family acceptance"; ADR 0035 rule 8).
 * What is left before the family's cells stand: a baseline to edit against, and every value Pea
 * staged, which a person keeps or reverts on the same cell beside its evidence. A Pea value with no
 * citation says so, and a family with no cut sheet is an assumption, not a blocker. Pure: the host
 * read runs it, and Pea reads the same Goal the pane draws.
 */
export function familyGoal(
  work: Pick<FamilyDraft, "reading" | "cells">,
  read: { member: boolean; profileError: string | null; spec: boolean; specError: string | null },
): Omit<Goal<string>, "inputs"> & { inputs: readonly never[] } {
  const staged = Object.entries(work.cells).filter(([, cell]) => cell.edit);
  const peas = staged.filter(([, cell]) => cell.edit?.by === "pea");
  const unresolved: Closer[] = [
    ...(work.reading || read.member
      ? []
      : [{ id: "capture", says: "No family to review: capture the open family, or open a saved one", resolver: { op: "family.capture" } }]),
    ...(read.profileError ? [{ id: "profile", says: `Saved family: ${read.profileError}`, resolver: "person" as const }] : []),
    ...(read.specError ? [{ id: "spec", says: `Cut sheet: ${read.specError}`, resolver: "person" as const }] : []),
    ...peas.map(([pointer, cell]): Closer => {
      const cited = cell.edit?.sources?.length ?? 0;
      return {
        id: `cell:${pointer}`,
        says: `Keep or revert Pea's ${pointer}: ${cited ? `cited to ${cited} region${cited === 1 ? "" : "s"} of the cut sheet` : "no citation"}`,
        resolver: "person",
      };
    }),
  ];
  return {
    unresolved,
    assumed: read.spec || read.specError
      ? []
      : [{ id: "spec", says: "No cut sheet attached: the values rest on the capture alone", resolver: { op: "family.attach-spec" } }],
    next: unresolved[0] ?? null,
    inputs: [],
    result: unresolved.length
      ? { kind: "estimate", value: null, sources: [] }
      : { kind: "complete", value: `${staged.length} staged cell${staged.length === 1 ? "" : "s"} reviewed` },
  };
}
