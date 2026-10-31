import { sameValue, type AppliedFilter, type FamiliesRouteDocument } from "@pe/agent-contracts";
import { reviewTransitions, type CellWire } from "#/components/work/band";
import { cellFromDraft, StateCell } from "@pe/kit/lang/cell";
import { SectionLabel } from "#/families/readout-primitives";
import { useFamiliesWorkspace } from "#/families/workspace-context";

import { filterWords } from "./filters";
export { filterWords };

export const standingFilterProposal = (scope: FamiliesRouteDocument["scope"]) =>
  scope.suggestion && !sameValue(scope.suggestion, scope.edit) ? scope.suggestion.value : null;

/** Pea's Work suggestion stays visible while the person's next read is prepared in the target. */
export function FamiliesScopeProposal() {
  const { store, wire, workUnreadable } = useFamiliesWorkspace();
  const scope = store.work?.doc.scope;
  const proposed = scope && !workUnreadable ? standingFilterProposal(scope) : null;
  const value = proposed ?? (!workUnreadable ? scope?.edit?.value : null);
  if (!scope || !value) return null;
  const show = (value: unknown) => filterWords(value as AppliedFilter);
  const scopeWire: CellWire = { segment: null, write: wire.write, revision: wire.revision };
  return (
    <div
      aria-label="Family scope"
      className="hairline-b flex shrink-0 flex-wrap items-baseline gap-1.5 px-2 py-1"
    >
      <SectionLabel>scope</SectionLabel>
      <span className="t-small">{proposed ? "Pea proposes" : "edit"}</span>
      <StateCell
        {...cellFromDraft(scope, { value: show(value) }, show)}
        transitions={reviewTransitions(scopeWire, "scope", scope)}
      />
    </div>
  );
}
