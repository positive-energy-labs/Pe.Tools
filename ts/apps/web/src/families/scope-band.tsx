import { sameValue, type AppliedFilter, type FamiliesRouteDocument } from "@pe/agent-contracts";
import { reviewTransitions, type CellWire } from "#/components/work/band";
import { cellFromTrichotomy, StateCell } from "@pe/kit/lang/cell";
import { SectionLabel } from "#/families/readout-primitives";
import { useFamiliesWorkspace } from "#/families/workspace-context";

const PLACEMENT_LABELS = {
  AllLoaded: "all loaded",
  PlacedOnly: "placed only",
  UnplacedOnly: "unplaced only",
} as const;

export const filterWords = (scope: AppliedFilter) =>
  `${scope.categoryNames.join(", ") || "every category"} · ${scope.familyNames.join(", ") || "every family"} · ${PLACEMENT_LABELS[scope.placementScope as keyof typeof PLACEMENT_LABELS]}`;

export const standingFilterProposal = (scope: FamiliesRouteDocument["scope"]) =>
  scope.proposal && !sameValue(scope.proposal, scope.staged) ? scope.proposal.value : null;

/** Pea's Work proposal stays visible while the person's next read is prepared in the target. */
export function FamiliesScopeProposal() {
  const { store, wire, workUnreadable } = useFamiliesWorkspace();
  const scope = store.handle.work.doc?.scope;
  const proposed = scope && !workUnreadable ? standingFilterProposal(scope) : null;
  const value = proposed ?? (!workUnreadable ? scope?.staged?.value : null);
  if (!scope || !value) return null;
  const show = (value: unknown) => filterWords(value as AppliedFilter);
  const scopeWire: CellWire = { segment: null, write: wire.write, revision: wire.revision };
  return (
    <div
      aria-label="Family scope"
      className="hairline-b flex shrink-0 flex-wrap items-baseline gap-1.5 px-2 py-1"
    >
      <SectionLabel>scope</SectionLabel>
      <span className="t-small">{proposed ? "Pea proposes" : "staged"}</span>
      <StateCell
        {...cellFromTrichotomy(scope, { value: show(value) }, show)}
        transitions={reviewTransitions(scopeWire, "scope", scope)}
      />
    </div>
  );
}
